import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STARTER_SKILL, STARTER_SKILL_TEXT, createRepos } from '@skirm/db';
import { createTestDb } from '@skirm/db/testing';
import {
  CachingKeyWrapper,
  DEV_SKILL_KEK,
  GcpKmsKeyWrapper,
  LocalKeyWrapper,
  crc32c,
  type KmsClient,
  Vault,
  VaultError,
  createVault,
  loadConfig,
  promptSha256,
  type SealedSkill,
} from '../src/index';

const kek = (n: number) => new Uint8Array(32).fill(n);
const prompt = 'Seal the gap at the spillway before tick 6, then collect gems.';
const reflexes = 'If water is next to the gap, place a block.';

const flip = (b: Uint8Array, i = 0) => {
  const c = Uint8Array.from(b);
  c[i] = c[i]! ^ 1;
  return c;
};

describe('vault', () => {
  it('prompt_sha256 = sha256(prompt + "\\n" + reflexes) (Spec §9)', () => {
    expect(promptSha256('a', 'b')).toBe(createHash('sha256').update('a\nb').digest('hex'));
    expect(promptSha256('a')).toBe(createHash('sha256').update('a\n').digest('hex'));
  });

  it('round-trips with a fresh data key per version', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const a = await vault.encryptSkill(prompt, reflexes);
    const b = await vault.encryptSkill(prompt, reflexes);
    expect(a.promptSha256).toBe(promptSha256(prompt, reflexes));
    expect(Buffer.from(a.ciphertext).toString('utf8')).not.toContain('spillway');
    expect(Buffer.from(a.wrappedKey).equals(Buffer.from(b.wrappedKey))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(a.iv.length).toBe(12);
    expect(a.authTag.length).toBe(16);
    expect(await vault.decryptSkill(a)).toEqual({ prompt, reflexes });
    const noReflex = await vault.encryptSkill(prompt);
    expect(await vault.decryptSkill(noReflex)).toEqual({ prompt });
  });

  it('detects tampering with any part', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const s = await vault.encryptSkill(prompt, reflexes);
    const cases: SealedSkill[] = [
      { ...s, ciphertext: flip(s.ciphertext, 3) },
      { ...s, iv: flip(s.iv) },
      { ...s, authTag: flip(s.authTag) },
      { ...s, wrappedKey: flip(s.wrappedKey, 20) },
      { ...s, wrappedKey: s.wrappedKey.slice(1) },
      { ...s, promptSha256: promptSha256('other prompt') },
    ];
    for (const c of cases) {
      const err = await vault.decryptSkill(c).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VaultError);
      expect((err as VaultError).code).toBe('tampered');
      expect((err as Error).message).not.toContain('spillway');
    }
    // Swapping ciphertext between versions is caught by the sha256 binding.
    const other = await vault.encryptSkill('another prompt');
    await expect(
      vault.decryptSkill({ ...other, promptSha256: s.promptSha256 }),
    ).rejects.toMatchObject({ code: 'tampered' });
  });

  it('refuses a truncated GCM tag or a non-96-bit nonce (no short-tag forgery)', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const s = await vault.encryptSkill(prompt, reflexes);
    // A 4-byte prefix of the real tag still authenticates in Node unless the length is pinned.
    for (const c of [
      { ...s, authTag: s.authTag.slice(0, 4) },
      { ...s, authTag: s.authTag.slice(0, 12) },
      { ...s, iv: new Uint8Array(16) },
    ]) {
      const err = await vault.decryptSkill(c).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VaultError);
      expect((err as VaultError).code).toBe('tampered');
    }
    expect(await vault.decryptSkill(s)).toEqual({ prompt, reflexes });
  });

  it('refuses another KEK', async () => {
    const s = await new Vault(new LocalKeyWrapper(kek(1))).encryptSkill(prompt);
    await expect(new Vault(new LocalKeyWrapper(kek(2))).decryptSkill(s)).rejects.toMatchObject({
      code: 'wrong_key',
    });
    const forged = new LocalKeyWrapper(kek(2));
    await expect(
      new Vault({
        keyId: s.keyId,
        wrap: (k) => forged.wrap(k),
        unwrap: (k) => forged.unwrap(k),
      }).decryptSkill(s),
    ).rejects.toMatchObject({ code: 'tampered' });
    expect(() => new LocalKeyWrapper(new Uint8Array(16))).toThrow(VaultError);
  });

  it('seals the starter skill into Postgres and opens it again', async () => {
    const vault = createVault(loadConfig({}));
    const db = await createTestDb();
    const repos = createRepos(db);
    await repos.accounts.getOrCreate({ handle: 'ana' }, vault);
    const sealed = await repos.skills.loadSealed(STARTER_SKILL.id, 1);
    expect(sealed!.keyId).toBe(vault.keyId);
    expect(await vault.decryptSkill(sealed!)).toEqual({ ...STARTER_SKILL_TEXT });
    expect((await repos.skills.get(STARTER_SKILL.id, 1))!.promptSha256).toBe(
      promptSha256(STARTER_SKILL_TEXT.prompt, STARTER_SKILL_TEXT.reflexes),
    );
  });
});

const KMS_KEY =
  'projects/skirm-staging/locations/us-central1/keyRings/skill-vault/cryptoKeys/skill-prompt-kek';

/** In-memory Cloud KMS: AES-GCM under a hidden key, AAD-bound, with the CRC32C fields. */
class FakeKms implements KmsClient {
  private readonly key = randomBytes(32);
  encrypts = 0;
  decrypts = 0;
  fail?: { code: number };
  lastError?: unknown;

  async encrypt(req: Parameters<KmsClient['encrypt']>[0]) {
    this.encrypts++;
    if (this.fail) throw Object.assign(new Error('UNAVAILABLE: kms down'), this.fail);
    expect(req.name).toBe(KMS_KEY);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(req.additionalAuthenticatedData);
    const ct = Buffer.concat([iv, c.update(req.plaintext), c.final(), c.getAuthTag()]);
    return [
      {
        name: `${req.name}/cryptoKeyVersions/1`,
        ciphertext: ct,
        ciphertextCrc32c: { value: String(crc32c(ct)) },
        verifiedPlaintextCrc32c: req.plaintextCrc32c.value === crc32c(req.plaintext),
        verifiedAdditionalAuthenticatedDataCrc32c:
          req.additionalAuthenticatedDataCrc32c.value === crc32c(req.additionalAuthenticatedData),
      },
    ] as [Awaited<ReturnType<KmsClient['encrypt']>>[0]];
  }

  async decrypt(req: Parameters<KmsClient['decrypt']>[0]) {
    this.decrypts++;
    if (this.fail) throw Object.assign(new Error('UNAVAILABLE: kms down'), this.fail);
    if (req.ciphertextCrc32c.value !== crc32c(req.ciphertext))
      throw Object.assign(new Error('checksum mismatch'), { code: 3 });
    try {
      const b = req.ciphertext;
      const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
      d.setAAD(req.additionalAuthenticatedData);
      d.setAuthTag(b.subarray(b.length - 16));
      const pt = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
      return [{ plaintext: pt, plaintextCrc32c: { value: crc32c(pt) } }] as [
        Awaited<ReturnType<KmsClient['decrypt']>>[0],
      ];
    } catch {
      throw Object.assign(new Error('INVALID_ARGUMENT: Decryption failed'), { code: 3 });
    }
  }
}

describe('Cloud KMS key wrapper', () => {
  it('crc32c matches the Castagnoli check value', () => {
    expect(crc32c(Buffer.from('123456789'))).toBe(0xe3069283);
  });

  it('seals and opens skills through KMS, recording the wrapper in key_id', async () => {
    const kms = new FakeKms();
    const vault = new Vault(new GcpKmsKeyWrapper(KMS_KEY, kms));
    const s = await vault.encryptSkill(prompt, reflexes);
    expect(s.keyId).toBe(`gcp-kms:${KMS_KEY}`);
    expect(Buffer.from(s.wrappedKey).length).toBeGreaterThan(32);
    expect(await vault.decryptSkill(s)).toEqual({ prompt, reflexes });
    for (const c of [
      { ...s, wrappedKey: flip(s.wrappedKey, 20) },
      { ...s, wrappedKey: new Uint8Array(0) },
      { ...s, ciphertext: flip(s.ciphertext, 2) },
    ]) {
      const err = await vault.decryptSkill(c).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'tampered' });
      expect(String((err as Error).message)).not.toMatch(/spillway|INVALID_ARGUMENT/);
    }
  });

  it('maps KMS outages to unavailable without leaking the KMS error', async () => {
    const kms = new FakeKms();
    const vault = new Vault(new GcpKmsKeyWrapper(KMS_KEY, kms));
    const s = await vault.encryptSkill(prompt, reflexes);
    kms.fail = { code: 14 };
    for (const p of [vault.encryptSkill(prompt), vault.decryptSkill(s)]) {
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VaultError);
      expect(err).toMatchObject({ code: 'unavailable' });
      expect((err as Error).message).not.toMatch(/spillway|kms down/);
    }
  });

  it('rejects a response that fails the CRC32C integrity check', async () => {
    const kms = new FakeKms();
    const bad: KmsClient = {
      encrypt: async (r) => {
        const [res] = await kms.encrypt(r);
        return [{ ...res, ciphertextCrc32c: { value: 1 } }];
      },
      decrypt: (r) => kms.decrypt(r),
    };
    await expect(
      new Vault(new GcpKmsKeyWrapper(KMS_KEY, bad)).encryptSkill(prompt),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});

describe('CachingKeyWrapper', () => {
  it('caches unwrapped data keys with a TTL and a bounded LRU', async () => {
    const kms = new FakeKms();
    let now = 0;
    const cached = new CachingKeyWrapper(new GcpKmsKeyWrapper(KMS_KEY, kms), {
      maxEntries: 2,
      ttlMs: 1000,
      now: () => now,
    });
    const vault = new Vault(cached);
    const a = await vault.encryptSkill(prompt, reflexes);
    // Sealing seeds the cache: the read-back costs no KMS call.
    expect(await vault.decryptSkill(a)).toEqual({ prompt, reflexes });
    expect(kms.decrypts).toBe(0);
    // Expired → KMS again, then cached.
    now = 1001;
    await vault.decryptSkill(a);
    await vault.decryptSkill(a);
    expect(kms.decrypts).toBe(1);
    // LRU bound: a and c are kept, b is evicted.
    const b = await vault.encryptSkill('b');
    await vault.decryptSkill(a);
    const c = await vault.encryptSkill('c');
    expect(cached.size).toBe(2);
    await vault.decryptSkill(a);
    await vault.decryptSkill(c);
    expect(kms.decrypts).toBe(1);
    await vault.decryptSkill(b);
    expect(kms.decrypts).toBe(2);
    // Vault zeroes the key it was handed; the cached copy must survive that.
    await vault.decryptSkill(b);
    expect(await vault.decryptSkill(b)).toEqual({ prompt: 'b' });
    expect(kms.decrypts).toBe(2);
    // A tampered wrapped key never hits the cache.
    await expect(
      vault.decryptSkill({ ...a, wrappedKey: flip(a.wrappedKey, 5) }),
    ).rejects.toMatchObject({
      code: 'tampered',
    });
    cached.clear();
    expect(cached.size).toBe(0);
  });
});

describe('createVault wrapper selection', () => {
  const env = (e: Record<string, string>) => loadConfig(e);

  // These cases are about the vault, not auth: a production env opts into dev auth like the local stack.
  const local = { NODE_ENV: 'production', ALLOW_DEV_IN_PRODUCTION: 'true' };

  it('uses KMS when SKILL_KEK is unset and SKILL_KEK_KMS is set', async () => {
    const c = env({ SKILL_KEK_KMS: KMS_KEY, ...local });
    expect(c.kekMode).toBe('kms');
    expect(c.devKek).toBe(false);
    expect(c.warnings).toEqual([]);
    const kms = new FakeKms();
    const vault = createVault(c, { kmsClient: kms });
    expect(vault.keyId).toBe(`gcp-kms:${KMS_KEY}`);
    const s = await vault.encryptSkill(prompt);
    expect(await createVault(c, { kmsClient: kms }).decryptSkill(s)).toEqual({ prompt });
    // Dev-key rows are not readable under KMS-only config.
    const dev = await createVault(env({})).encryptSkill(prompt);
    await expect(vault.decryptSkill(dev)).rejects.toMatchObject({ code: 'wrong_key' });
  });

  it('keeps local-KEK rows readable; with both set the local KEK seals and KMS still opens', async () => {
    const local = Buffer.from(kek(7)).toString('base64');
    const kms = new FakeKms();
    const localRow = await createVault(env({ SKILL_KEK: local })).encryptSkill(prompt, reflexes);
    const kmsRow = await createVault(env({ SKILL_KEK_KMS: KMS_KEY }), {
      kmsClient: kms,
    }).encryptSkill('kms sealed');
    const both = env({ SKILL_KEK: local, SKILL_KEK_KMS: KMS_KEY });
    expect(both.kekMode).toBe('local');
    const v = createVault(both, { kmsClient: kms });
    expect(v.keyId).toBe(localRow.keyId);
    expect(await v.decryptSkill(localRow)).toEqual({ prompt, reflexes });
    expect(await v.decryptSkill(kmsRow)).toEqual({ prompt: 'kms sealed' });
  });

  it('warns on the dev KEK in a production local stack (ALLOW_DEV_IN_PRODUCTION) without KMS', () => {
    const prod = env(local);
    expect(prod.devKek).toBe(true);
    expect(prod.warnings).toHaveLength(1);
    expect(prod.warnings[0]).toMatch(/dev key/);
    expect(prod.warnings[0]).not.toContain(DEV_SKILL_KEK);
    expect(env({ ...local, SKILL_KEK: DEV_SKILL_KEK }).warnings).toHaveLength(1);
    expect(env({}).warnings).toEqual([]);
    expect(
      env({ ...local, SKILL_KEK: Buffer.from(kek(3)).toString('base64') }).warnings,
    ).toEqual([]);
    expect(() => env({ SKILL_KEK_KMS: 'skill-prompt-kek' })).toThrow(/SKILL_KEK_KMS/);
  });

  it('refuses dev auth and the dev KEK in production unless the stack opts in', () => {
    const privy = { AUTH_MODE: 'privy', PRIVY_APP_ID: 'app', PRIVY_VERIFICATION_KEY: 'key' };
    // Dev auth: anyone could sign in as anyone and pay with dev: hashes.
    expect(() => env({ NODE_ENV: 'production', SKILL_KEK_KMS: KMS_KEY })).toThrow(/AUTH_MODE/);
    // The public dev key: skill prompts unprotected.
    expect(() => env({ NODE_ENV: 'production', ...privy })).toThrow(/SKILL_KEK/);
    expect(() => env({ NODE_ENV: 'production', ...privy, SKILL_KEK: DEV_SKILL_KEK })).toThrow(/SKILL_KEK/);
    // A real production config starts; so does the local stack that opts in; development is unaffected.
    expect(env({ NODE_ENV: 'production', ...privy, SKILL_KEK_KMS: KMS_KEY }).AUTH_MODE).toBe('privy');
    expect(env({ ...local, ALLOW_DEV_IN_PRODUCTION: 'true' }).AUTH_MODE).toBe('dev');
    expect(env({}).AUTH_MODE).toBe('dev');
    expect(() => env({ NODE_ENV: 'production', ALLOW_DEV_IN_PRODUCTION: 'false' })).toThrow(/AUTH_MODE/);
  });
});
