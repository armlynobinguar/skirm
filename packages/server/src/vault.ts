// Envelope encryption of skill text (arch.md Secrets, Spec §9 hidden-prompt rule).
// Each skill version gets a random 256-bit data key; the text is sealed with AES-256-GCM under it,
// and the data key is wrapped by the KEK (Cloud KMS `skill-prompt-kek`, or SKILL_KEK locally).
// Errors never carry the text, and nothing here logs.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { SealedPlaybook, SealedSkill, SkillSealer } from '@skirm/db';
import type { ServerConfig } from './config';

export type { SealedSkill } from '@skirm/db';

export class VaultError extends Error {
  constructor(
    readonly code: 'not_configured' | 'tampered' | 'wrong_key' | 'invalid_key' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

/** Wraps and unwraps data keys with a key-encryption key. */
export interface KeyWrapper {
  readonly keyId: string;
  wrap(dataKey: Uint8Array): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
}

const WRAP_AAD = Buffer.from('skirm/dek/v1');

/** AES-256-GCM key wrap with a local 32-byte KEK: iv(12) ‖ tag(16) ‖ ciphertext(32). */
export class LocalKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  private readonly kek: Buffer;

  constructor(kek: Uint8Array) {
    if (kek.length !== 32) throw new VaultError('invalid_key', 'KEK must be 32 bytes');
    this.kek = Buffer.from(kek);
    this.keyId = `local:${createHash('sha256').update(this.kek).digest('hex').slice(0, 16)}`;
  }

  async wrap(dataKey: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.kek, iv);
    c.setAAD(WRAP_AAD);
    const ct = Buffer.concat([c.update(dataKey), c.final()]);
    return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct]));
  }

  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const b = Buffer.from(wrapped);
    if (b.length !== 12 + 16 + 32)
      throw new VaultError('tampered', 'wrapped key has the wrong length');
    try {
      const d = createDecipheriv('aes-256-gcm', this.kek, b.subarray(0, 12), { authTagLength: 16 });
      d.setAAD(WRAP_AAD);
      d.setAuthTag(b.subarray(12, 28));
      return new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()]));
    } catch {
      throw new VaultError('tampered', 'data key failed authentication');
    }
  }
}

/** Subset of `@google-cloud/kms` KeyManagementServiceClient that GcpKmsKeyWrapper uses. */
export interface KmsClient {
  encrypt(req: {
    name: string;
    plaintext: Buffer;
    additionalAuthenticatedData: Buffer;
    plaintextCrc32c: { value: number };
    additionalAuthenticatedDataCrc32c: { value: number };
  }): Promise<
    [
      {
        name?: string | null;
        ciphertext?: Uint8Array | string | null;
        ciphertextCrc32c?: { value?: number | string | { toString(): string } | null } | null;
        verifiedPlaintextCrc32c?: boolean | null;
        verifiedAdditionalAuthenticatedDataCrc32c?: boolean | null;
      },
      ...unknown[],
    ]
  >;
  decrypt(req: {
    name: string;
    ciphertext: Buffer;
    additionalAuthenticatedData: Buffer;
    ciphertextCrc32c: { value: number };
    additionalAuthenticatedDataCrc32c: { value: number };
  }): Promise<
    [
      {
        plaintext?: Uint8Array | string | null;
        plaintextCrc32c?: { value?: number | string | { toString(): string } | null } | null;
      },
      ...unknown[],
    ]
  >;
}

const CRC32C_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32C (Castagnoli), as Cloud KMS uses for request/response integrity checks. */
export function crc32c(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC32C_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const crcOf = (
  v: { value?: number | string | { toString(): string } | null } | null | undefined,
) => (v?.value === undefined || v.value === null ? undefined : Number(v.value.toString()));
const bytesOf = (v: Uint8Array | string | null | undefined) =>
  v == null ? undefined : typeof v === 'string' ? Buffer.from(v, 'base64') : Buffer.from(v);
/** gRPC INVALID_ARGUMENT: KMS could not decrypt (tampered or foreign ciphertext). */
const GRPC_INVALID_ARGUMENT = 3;

/**
 * Cloud KMS (`projects/…/cryptoKeys/skill-prompt-kek`) wraps the data keys; credentials from ADC.
 * The wrapped key is the raw KMS ciphertext (bound to AAD `skirm/dek/v1`), and keyId
 * `gcp-kms:<key name>` records the wrapper on each row. KMS picks the key version on decrypt, so
 * rotating the key keeps old rows readable. Errors never carry KMS messages or key material.
 */
export class GcpKmsKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  private client?: Promise<KmsClient>;

  constructor(
    readonly keyName: string,
    client?: KmsClient,
  ) {
    this.keyId = `gcp-kms:${keyName}`;
    if (client) this.client = Promise.resolve(client);
  }

  private kms(): Promise<KmsClient> {
    this.client ??= import('@google-cloud/kms').then((m) => {
      const Ctor = (m.KeyManagementServiceClient ??
        (m as unknown as { default: typeof m }).default
          .KeyManagementServiceClient) as new () => unknown;
      return new Ctor() as KmsClient;
    });
    return this.client;
  }

  async wrap(dataKey: Uint8Array): Promise<Uint8Array> {
    const plaintext = Buffer.from(dataKey);
    try {
      const [res] = await (
        await this.kms()
      ).encrypt({
        name: this.keyName,
        plaintext,
        additionalAuthenticatedData: WRAP_AAD,
        plaintextCrc32c: { value: crc32c(plaintext) },
        additionalAuthenticatedDataCrc32c: { value: crc32c(WRAP_AAD) },
      });
      const ct = bytesOf(res.ciphertext);
      if (
        !ct ||
        res.verifiedPlaintextCrc32c !== true ||
        res.verifiedAdditionalAuthenticatedDataCrc32c !== true ||
        crcOf(res.ciphertextCrc32c) !== crc32c(ct)
      )
        throw new VaultError('unavailable', 'KMS encrypt response failed its integrity check');
      return new Uint8Array(ct);
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultError('unavailable', 'KMS encrypt failed');
    } finally {
      plaintext.fill(0);
    }
  }

  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const ciphertext = Buffer.from(wrapped);
    if (ciphertext.length === 0 || ciphertext.length > 64 * 1024)
      throw new VaultError('tampered', 'wrapped key has the wrong length');
    let res: Awaited<ReturnType<KmsClient['decrypt']>>[0];
    try {
      [res] = await (
        await this.kms()
      ).decrypt({
        name: this.keyName,
        ciphertext,
        additionalAuthenticatedData: WRAP_AAD,
        ciphertextCrc32c: { value: crc32c(ciphertext) },
        additionalAuthenticatedDataCrc32c: { value: crc32c(WRAP_AAD) },
      });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === GRPC_INVALID_ARGUMENT)
        throw new VaultError('tampered', 'data key failed authentication');
      throw new VaultError('unavailable', 'KMS decrypt failed');
    }
    const pt = bytesOf(res.plaintext);
    if (!pt || crcOf(res.plaintextCrc32c) !== crc32c(pt)) {
      pt?.fill(0);
      throw new VaultError('unavailable', 'KMS decrypt response failed its integrity check');
    }
    if (pt.length !== 32) {
      pt.fill(0);
      throw new VaultError('tampered', 'data key has the wrong length');
    }
    return new Uint8Array(pt);
  }
}

/**
 * Caches unwrapped data keys in memory (bounded LRU with a TTL) so hot skills don't cost a KMS call
 * per decision. Keys are by sha256(keyId ‖ wrapped key); callers get a copy, evicted keys are zeroed.
 * Data keys sealed through this wrapper are cached too (a fresh skill is usually read back soon).
 */
export class CachingKeyWrapper implements KeyWrapper {
  private readonly cache = new Map<string, { key: Buffer; expires: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: KeyWrapper,
    opts: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
  ) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 256);
    this.ttlMs = Math.max(0, opts.ttlMs ?? 5 * 60_000);
    this.now = opts.now ?? Date.now;
  }

  get keyId(): string {
    return this.inner.keyId;
  }

  /** Entries currently held (expired ones are dropped lazily). */
  get size(): number {
    return this.cache.size;
  }

  private id(wrapped: Uint8Array): string {
    return createHash('sha256').update(this.inner.keyId).update('\0').update(wrapped).digest('hex');
  }

  private remember(id: string, dataKey: Uint8Array): void {
    if (this.ttlMs === 0) return;
    this.drop(id);
    this.cache.set(id, { key: Buffer.from(dataKey), expires: this.now() + this.ttlMs });
    while (this.cache.size > this.maxEntries) this.drop(this.cache.keys().next().value!);
  }

  private drop(id: string): void {
    const e = this.cache.get(id);
    if (!e) return;
    e.key.fill(0);
    this.cache.delete(id);
  }

  /** Forgets every cached data key. */
  clear(): void {
    for (const id of [...this.cache.keys()]) this.drop(id);
  }

  async wrap(dataKey: Uint8Array): Promise<Uint8Array> {
    const wrapped = await this.inner.wrap(dataKey);
    this.remember(this.id(wrapped), dataKey);
    return wrapped;
  }

  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const id = this.id(wrapped);
    const hit = this.cache.get(id);
    if (hit) {
      if (hit.expires > this.now()) {
        this.cache.delete(id);
        this.cache.set(id, hit); // most recently used
        return new Uint8Array(hit.key);
      }
      this.drop(id);
    }
    const dataKey = await this.inner.unwrap(wrapped);
    this.remember(id, dataKey);
    return dataKey;
  }
}

/** Spec §9: SHA-256 of the UTF-8 `prompt + '\n' + reflexes` (reflexes empty when absent). */
export function promptSha256(prompt: string, reflexes?: string | null): string {
  return createHash('sha256')
    .update(`${prompt}\n${reflexes ?? ''}`, 'utf8')
    .digest('hex');
}

export interface SkillText {
  prompt: string;
  reflexes?: string;
}

const aadFor = (sha: string) => Buffer.from(`skirm/skill/v1:${sha}`);
/** A playbook's AAD differs from a skill's, so neither row ever opens as the other. */
const playbookAad = (sha: string) => Buffer.from(`skirm/playbook/v1:${sha}`);

/** sha256 of a crew playbook's UTF-8 text (bound into its AAD). */
export function playbookSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class Vault implements SkillSealer {
  private readonly openers = new Map<string, KeyWrapper>();

  /**
   * `wrapper` seals new versions; it and `readers` open rows whose key_id matches theirs (key_id
   * records which wrapper sealed a row, so local-KEK and KMS rows can live side by side).
   */
  constructor(
    private readonly wrapper: KeyWrapper,
    readers: KeyWrapper[] = [],
  ) {
    for (const w of [...readers, wrapper]) this.openers.set(w.keyId, w);
  }

  get keyId(): string {
    return this.wrapper.keyId;
  }

  /** Seals one skill version's text under a fresh data key. */
  async encryptSkill(prompt: string, reflexes?: string): Promise<SealedSkill> {
    const sha = promptSha256(prompt, reflexes);
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', dataKey, iv);
      c.setAAD(aadFor(sha));
      const body: SkillText = reflexes === undefined ? { prompt } : { prompt, reflexes };
      const ciphertext = Buffer.concat([c.update(JSON.stringify(body), 'utf8'), c.final()]);
      return {
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(c.getAuthTag()),
        wrappedKey: await this.wrapper.wrap(dataKey),
        keyId: this.wrapper.keyId,
        promptSha256: sha,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * Opens a sealed version. Only the agent runner (worker/realtime) and the creator read-back on
   * GET /skills/:id may call this. Any change to ciphertext, iv, tag, wrapped key or prompt_sha256
   * fails with VaultError('tampered').
   */
  async decryptSkill(sealed: SealedSkill): Promise<SkillText> {
    const opener = this.openers.get(sealed.keyId);
    if (!opener) throw new VaultError('wrong_key', 'sealed with a different key-encryption key');
    // GCM must get exactly a 96-bit nonce and a full 128-bit tag: Node accepts tags as short as
    // 4 bytes, which would let anyone who can write the row forge ciphertext in ~2^32 tries.
    if (sealed.iv.length !== IV_BYTES || sealed.authTag.length !== TAG_BYTES)
      throw new VaultError('tampered', 'skill ciphertext failed authentication');
    const dataKey = Buffer.from(await opener.unwrap(sealed.wrappedKey));
    let text: SkillText;
    try {
      const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv), {
        authTagLength: TAG_BYTES,
      });
      d.setAAD(aadFor(sealed.promptSha256));
      d.setAuthTag(Buffer.from(sealed.authTag));
      const plain = Buffer.concat([d.update(Buffer.from(sealed.ciphertext)), d.final()]);
      text = JSON.parse(plain.toString('utf8')) as SkillText;
    } catch {
      throw new VaultError('tampered', 'skill ciphertext failed authentication');
    } finally {
      dataKey.fill(0);
    }
    const sha = Buffer.from(promptSha256(text.prompt, text.reflexes), 'hex');
    const want = Buffer.from(sealed.promptSha256, 'hex');
    if (sha.length !== want.length || !timingSafeEqual(sha, want))
      throw new VaultError('tampered', 'prompt_sha256 does not match the sealed text');
    return text;
  }

  /** Seals a crew playbook's text under a fresh data key, with its own AAD (never a skill's). */
  async encryptPlaybook(text: string): Promise<SealedPlaybook> {
    const sha = playbookSha256(text);
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(IV_BYTES);
      const c = createCipheriv('aes-256-gcm', dataKey, iv);
      c.setAAD(playbookAad(sha));
      const ciphertext = Buffer.concat([c.update(JSON.stringify({ text }), 'utf8'), c.final()]);
      return {
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(c.getAuthTag()),
        wrappedKey: await this.wrapper.wrap(dataKey),
        keyId: this.wrapper.keyId,
        promptSha256: sha,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * Opens a sealed playbook. Only its owner's read-back (GET /playbooks/:id, GET /me/export) and the
   * match runner (realtime) call this. Any change to the row fails with VaultError('tampered').
   */
  async decryptPlaybook(sealed: SealedPlaybook): Promise<string> {
    const opener = this.openers.get(sealed.keyId);
    if (!opener) throw new VaultError('wrong_key', 'sealed with a different key-encryption key');
    if (sealed.iv.length !== IV_BYTES || sealed.authTag.length !== TAG_BYTES)
      throw new VaultError('tampered', 'playbook ciphertext failed authentication');
    const dataKey = Buffer.from(await opener.unwrap(sealed.wrappedKey));
    let text: unknown;
    try {
      const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv), {
        authTagLength: TAG_BYTES,
      });
      d.setAAD(playbookAad(sealed.promptSha256));
      d.setAuthTag(Buffer.from(sealed.authTag));
      const plain = Buffer.concat([d.update(Buffer.from(sealed.ciphertext)), d.final()]);
      text = (JSON.parse(plain.toString('utf8')) as { text?: unknown }).text;
    } catch {
      throw new VaultError('tampered', 'playbook ciphertext failed authentication');
    } finally {
      dataKey.fill(0);
    }
    if (typeof text !== 'string')
      throw new VaultError('tampered', 'playbook ciphertext failed authentication');
    const sha = Buffer.from(playbookSha256(text), 'hex');
    const want = Buffer.from(sealed.promptSha256, 'hex');
    if (sha.length !== want.length || !timingSafeEqual(sha, want))
      throw new VaultError('tampered', 'the sha256 does not match the sealed playbook');
    return text;
  }

  /** Seals a server-held secret (an agent account's NEAR key) for `label` (see SealedSecret). */
  async encryptSecret(label: string, secret: string): Promise<SealedSecret> {
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(IV_BYTES);
      const c = createCipheriv('aes-256-gcm', dataKey, iv);
      c.setAAD(secretAad(label));
      const ciphertext = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
      return {
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(c.getAuthTag()),
        wrappedKey: await this.wrapper.wrap(dataKey),
        keyId: this.wrapper.keyId,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * Opens a secret sealed by encryptSecret under the same `label`. Only the agent-account signer in
   * the api calls this, right before it signs; the result is never logged or returned.
   */
  async decryptSecret(label: string, sealed: SealedSecret): Promise<string> {
    const opener = this.openers.get(sealed.keyId);
    if (!opener) throw new VaultError('wrong_key', 'sealed with a different key-encryption key');
    if (sealed.iv.length !== IV_BYTES || sealed.authTag.length !== TAG_BYTES)
      throw new VaultError('tampered', 'secret failed authentication');
    const dataKey = Buffer.from(await opener.unwrap(sealed.wrappedKey));
    try {
      const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv), {
        authTagLength: TAG_BYTES,
      });
      d.setAAD(secretAad(label));
      d.setAuthTag(Buffer.from(sealed.authTag));
      return Buffer.concat([d.update(Buffer.from(sealed.ciphertext)), d.final()]).toString('utf8');
    } catch {
      throw new VaultError('tampered', 'secret failed authentication');
    } finally {
      dataKey.fill(0);
    }
  }
}

/**
 * A server-held secret (an agent account's NEAR key), sealed like a skill: a fresh data key under
 * the KEK, the text under AES-256-GCM with an AAD naming what the secret belongs to (`label`), so a
 * sealed row moved to another account fails to open.
 */
export interface SealedSecret {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedKey: Uint8Array;
  keyId: string;
}

const secretAad = (label: string) => Buffer.from(`skirm/secret/v1:${label}`);

/**
 * Vault from config. kekMode 'kms' (SKILL_KEK unset, SKILL_KEK_KMS set): Cloud KMS seals, behind a
 * data-key cache. Otherwise SKILL_KEK (or the dev key) seals, and SKILL_KEK_KMS, when also set,
 * still opens rows sealed by KMS.
 */
export function createVault(
  config: Pick<ServerConfig, 'kek'> & Partial<Pick<ServerConfig, 'kekMode' | 'SKILL_KEK_KMS'>>,
  opts: { kmsClient?: KmsClient; cache?: { maxEntries?: number; ttlMs?: number } } = {},
): Vault {
  const kms = config.SKILL_KEK_KMS
    ? new CachingKeyWrapper(new GcpKmsKeyWrapper(config.SKILL_KEK_KMS, opts.kmsClient), opts.cache)
    : undefined;
  if (config.kekMode === 'kms') {
    if (!kms) throw new VaultError('not_configured', 'SKILL_KEK_KMS is not set');
    return new Vault(kms);
  }
  return new Vault(new LocalKeyWrapper(config.kek), kms ? [kms] : []);
}
