// Encrypt inputs for, and decrypt results from, FHEVM contracts with the Zama relayer SDK.
//
// - encryptU64 / encryptU8: an encrypted input bound to (contract, user), passed to the contract as
//   `externalEuint64` / `externalEuint8` plus the input proof.
// - userDecrypt: the user signs an EIP-712 request with a throwaway keypair; the KMS re-encrypts the
//   handles (which the user must hold ACL access to) to that key and the SDK decrypts locally.
// - publicDecrypt: handles a contract marked publicly decryptable (FHE.makePubliclyDecryptable).
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web';
import { trackRelayer, trackStep } from './steps';

export type Hex = `0x${string}`;

/** A bytes32 ciphertext handle as returned by a contract view (e.g. confidentialBalanceOf). */
export type Handle = Hex;

export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_U8 = 255n;

/** An all-zero handle means "never set": the value is 0 and there is nothing to decrypt. */
export const ZERO_HANDLE: Handle = `0x${'0'.repeat(64)}`;

export function isZeroHandle(handle: string): boolean {
  return /^0x0{64}$/i.test(handle);
}

/** Lower-case 0x hex of a byte array (handles and proofs come back from the SDK as bytes). */
export function toHex(bytes: Uint8Array | string): Hex {
  if (typeof bytes === 'string') return (bytes.startsWith('0x') ? bytes : `0x${bytes}`) as Hex;
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out as Hex;
}

/** Checks `value` is an integer in [0, max] and returns it as a bigint. */
export function checkUint(value: number | bigint, max: bigint, label: string): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError(`${label}: ${value} is not an integer`);
  const v = BigInt(value);
  if (v < 0n || v > max) throw new RangeError(`${label}: ${v} is out of range (0..${max})`);
  return v;
}

export interface EncryptedInput {
  /** The `externalEuintN` argument. */
  handle: Hex;
  /** The `bytes inputProof` argument. */
  inputProof: Hex;
}

type Instance = Pick<FhevmInstance, 'createEncryptedInput' | 'generateKeypair' | 'createEIP712' | 'userDecrypt' | 'publicDecrypt'>;

/** Encrypts a uint64 for `contract`, to be submitted by `user`. */
export async function encryptU64(instance: Instance, contract: string, user: string, value: number | bigint): Promise<EncryptedInput> {
  const v = checkUint(value, MAX_U64, 'encryptU64');
  const { handles, inputProof } = await trackRelayer('encrypt', () => instance.createEncryptedInput(contract, user).add64(v).encrypt());
  return { handle: toHex(handles[0]!), inputProof: toHex(inputProof) };
}

/** Encrypts a uint8 for `contract`, to be submitted by `user`. */
export async function encryptU8(instance: Instance, contract: string, user: string, value: number | bigint): Promise<EncryptedInput> {
  const v = checkUint(value, MAX_U8, 'encryptU8');
  const { handles, inputProof } = await trackRelayer('encrypt', () => instance.createEncryptedInput(contract, user).add8(v).encrypt());
  return { handle: toHex(handles[0]!), inputProof: toHex(inputProof) };
}

export interface EncryptedInputs {
  /** One `externalEuintN` argument per value, in order. */
  handles: Hex[];
  /** The `bytes inputProof` shared by all of them. */
  inputProof: Hex;
}

/** Encrypts several uint8 values under one proof for `contract`, to be submitted by `user`. */
export async function encryptU8s(instance: Instance, contract: string, user: string, values: readonly (number | bigint)[]): Promise<EncryptedInputs> {
  const input = instance.createEncryptedInput(contract, user);
  values.forEach((v, i) => input.add8(checkUint(v, MAX_U8, `encryptU8s[${i}]`)));
  const { handles, inputProof } = await trackRelayer('encrypt', () => input.encrypt());
  return { handles: handles.map((h) => toHex(h)), inputProof: toHex(inputProof) };
}

/** What the decrypt request needs from a wallet signer (an ethers JsonRpcSigner fits). */
export interface TypedDataSigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
  ): Promise<string>;
}

export interface HandleRef {
  handle: Handle;
  contractAddress: string;
}

/** Days a signed user-decrypt authorisation stays valid (so Reveal does not prompt every time). */
export const DECRYPT_AUTH_DAYS = 1;

interface DecryptAuth {
  publicKey: string;
  privateKey: string;
  signature: string;
  startTimestamp: number;
  durationDays: number;
}

/** In-memory signed authorisations, keyed by user + sorted contract list (gone on reload). */
const authCache = new Map<string, DecryptAuth>();

/** Sorted, de-duplicated, lower-cased contract list (the EIP-712 request covers this set). */
export function contractSet(refs: readonly HandleRef[]): string[] {
  return [...new Set(refs.map((r) => r.contractAddress.toLowerCase()))].sort();
}

export function authIsFresh(auth: Pick<DecryptAuth, 'startTimestamp' | 'durationDays'>, nowSec: number): boolean {
  // Renew a minute early so a request never reaches the KMS with an expired window.
  return nowSec < auth.startTimestamp + auth.durationDays * 86_400 - 60;
}

async function decryptAuth(instance: Instance, signer: TypedDataSigner, user: string, contracts: string[]): Promise<DecryptAuth> {
  const key = `${user.toLowerCase()}|${contracts.join(',')}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = authCache.get(key);
  if (cached && authIsFresh(cached, nowSec)) return cached;

  const { publicKey, privateKey } = instance.generateKeypair();
  const eip712 = instance.createEIP712(publicKey, contracts, nowSec, DECRYPT_AUTH_DAYS);
  const signature = await trackStep('sign', () =>
    signer.signTypedData(
      eip712.domain as unknown as Record<string, unknown>,
      { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
      eip712.message as unknown as Record<string, unknown>,
    ),
  );
  const auth = { publicKey, privateKey, signature: signature.replace(/^0x/, ''), startTimestamp: nowSec, durationDays: DECRYPT_AUTH_DAYS };
  authCache.set(key, auth);
  return auth;
}

/** Forgets signed decrypt authorisations (on wallet change or disconnect). */
export function clearDecryptAuth(): void {
  authCache.clear();
}

/**
 * Decrypts handles the connected user is allowed to read. Zero handles decrypt to 0n without a
 * relayer round trip. Returns one value per input ref, in order.
 */
export async function userDecrypt(instance: Instance, signer: TypedDataSigner, refs: readonly HandleRef[]): Promise<Array<bigint | boolean | Hex>> {
  const live = refs.filter((r) => !isZeroHandle(r.handle));
  let clear: Record<string, bigint | boolean | Hex> = {};
  if (live.length > 0) {
    const user = await signer.getAddress();
    const contracts = contractSet(live);
    const auth = await decryptAuth(instance, signer, user, contracts);
    clear = await trackRelayer('decrypt', () =>
      instance.userDecrypt(
        live.map((r) => ({ handle: r.handle, contractAddress: r.contractAddress })),
        auth.privateKey,
        auth.publicKey,
        auth.signature,
        contracts,
        user,
        auth.startTimestamp,
        auth.durationDays,
      ),
    );
  }
  return refs.map((r) => (isZeroHandle(r.handle) ? 0n : lookup(clear, r.handle)));
}

/** Decrypts one handle to a bigint (euint values). */
export async function userDecryptUint(instance: Instance, signer: TypedDataSigner, ref: HandleRef): Promise<bigint> {
  const [v] = await userDecrypt(instance, signer, [ref]);
  if (typeof v !== 'bigint') throw new TypeError(`Handle ${ref.handle} is not an integer ciphertext`);
  return v;
}

export interface PublicDecryption {
  values: Array<bigint | boolean | Hex>;
  /** ABI-encoded clear values and KMS proof, for contracts that verify with FHE.checkSignatures. */
  abiEncodedClearValues: Hex;
  decryptionProof: Hex;
}

/** Decrypts handles that were made publicly decryptable on chain. */
export async function publicDecrypt(instance: Instance, handles: readonly Handle[]): Promise<PublicDecryption> {
  const res = await trackRelayer('decrypt', () => instance.publicDecrypt([...handles]));
  return {
    values: handles.map((h) => lookup(res.clearValues, h)),
    abiEncodedClearValues: res.abiEncodedClearValues,
    decryptionProof: res.decryptionProof,
  };
}

/** The SDK keys results by handle hex; match case-insensitively. */
function lookup(values: Readonly<Record<string, bigint | boolean | Hex>>, handle: string): bigint | boolean | Hex {
  if (handle in values) return values[handle]!;
  const lower = handle.toLowerCase();
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return v;
  throw new Error(`The relayer returned no value for handle ${handle}`);
}

/** Formats base units (6 decimals, like ERC-7984's default) as a grouped decimal string. */
export function formatUnits6(value: bigint, maxFraction = 2): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = (abs / 1_000_000n).toLocaleString('en-US');
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
