// NEP-366 meta-transactions: the SignedDelegate a player's wallet signs so that a relayer, not the
// player, pays the gas (docs/gasless.md). This file only reads bytes; it never signs or sends.
//
//   SignedDelegate = borsh { delegate_action: DelegateAction, signature: Signature }
//   DelegateAction = borsh { sender_id: string, receiver_id: string, actions: Vec<NonDelegateAction>,
//                            nonce: u64, max_block_height: u64, public_key: PublicKey }
//   signed bytes   = sha256( u32 LE (2^30 + 366) ‖ borsh(DelegateAction) )      (NEP-461 prefix)
//
// The decoder is strict on purpose: it knows only FunctionCall (action tag 2) in detail, reports
// every other action by its tag so the caller can refuse it, accepts ed25519 keys and signatures
// only, and refuses trailing bytes. A relayer then never pays for something it did not read.
import { createHash, createPublicKey, verify } from 'node:crypto';

export interface DelegateFunctionCall {
  kind: 'FunctionCall';
  methodName: string;
  /** Raw argument bytes (JSON for skirm's contracts). */
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

/** Any action other than FunctionCall, by its borsh enum tag (0 CreateAccount, 3 Transfer, ...). */
interface DelegateOtherAction {
  kind: 'Other';
  tag: number;
}

type DelegateActionItem = DelegateFunctionCall | DelegateOtherAction;

export interface DecodedSignedDelegate {
  senderId: string;
  receiverId: string;
  /** Function calls only: any other action is refused while decoding. */
  actions: DelegateFunctionCall[];
  nonce: bigint;
  maxBlockHeight: bigint;
  /** `ed25519:<base58>`. */
  publicKey: string;
  publicKeyBytes: Uint8Array;
  signature: Uint8Array;
  /** borsh(DelegateAction): the bytes the signature covers (after the NEP-461 prefix). */
  delegateActionBytes: Uint8Array;
  /** The whole SignedDelegate as received. */
  bytes: Uint8Array;
}

export class DelegateDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelegateDecodeError';
  }
}

/** NEP-461 prefix for NEP-366 delegate actions. */
export const DELEGATE_ACTION_PREFIX = 2 ** 30 + 366;
const FUNCTION_CALL_TAG = 2;
/** Highest action tag nearcore knows today; anything above is not an action at all. */
const MAX_ACTION_TAG = 13;
const MAX_ACTIONS = 16;
const MAX_STRING = 1024;
const MAX_ARGS = 16 * 1024;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

class Reader {
  private off = 0;
  constructor(private readonly buf: Uint8Array) {}
  get offset(): number {
    return this.off;
  }
  get done(): boolean {
    return this.off === this.buf.length;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.off + n > this.buf.length) throw new DelegateDecodeError('unexpected end of data');
    const out = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0]!;
  }
  u32(): number {
    const b = this.bytes(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16)) + b[3]! * 2 ** 24;
  }
  uint(bytes: number): bigint {
    const b = this.bytes(bytes);
    let n = 0n;
    for (let i = bytes - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
    return n;
  }
  string(max = MAX_STRING): string {
    const len = this.u32();
    if (len > max) throw new DelegateDecodeError('string too long');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(len));
    } catch (err) {
      if (err instanceof DelegateDecodeError) throw err;
      throw new DelegateDecodeError('string is not UTF-8');
    }
  }
}

function readAction(r: Reader): DelegateActionItem {
  const tag = r.u8();
  if (tag > MAX_ACTION_TAG) throw new DelegateDecodeError(`unknown action ${tag}`);
  // Only FunctionCall has a layout here; the caller refuses anything else, so decoding stops.
  if (tag !== FUNCTION_CALL_TAG) return { kind: 'Other', tag };
  const methodName = r.string();
  const argsLen = r.u32();
  if (argsLen > MAX_ARGS) throw new DelegateDecodeError('arguments too long');
  const args = r.bytes(argsLen);
  const gas = r.uint(8);
  const deposit = r.uint(16);
  return { kind: 'FunctionCall', methodName, args, gas, deposit };
}

/**
 * Decodes a borsh SignedDelegate. Throws DelegateDecodeError on anything malformed, and its subclass
 * DelegateActionNotAllowed on the first action that is not a FunctionCall (that action's layout is
 * not read, so decoding cannot go on). Callers only ever see whole, function-call-only delegates.
 */
export function decodeSignedDelegate(bytes: Uint8Array): DecodedSignedDelegate {
  const r = new Reader(bytes);
  const start = r.offset;
  const senderId = r.string(64);
  const receiverId = r.string(64);
  const count = r.u32();
  if (count < 1 || count > MAX_ACTIONS) throw new DelegateDecodeError('expected 1 to 16 actions');
  const actions: DelegateFunctionCall[] = [];
  for (let i = 0; i < count; i++) {
    const a = readAction(r);
    // The layout of other actions is not read, so the rest cannot be located: report and stop.
    if (a.kind === 'Other') throw new DelegateActionNotAllowed(a.tag);
    actions.push(a);
  }
  const nonce = r.uint(8);
  const maxBlockHeight = r.uint(8);
  const keyType = r.u8();
  if (keyType !== 0) throw new DelegateDecodeError('only ed25519 keys are supported');
  const publicKeyBytes = r.bytes(32);
  const delegateActionBytes = bytes.subarray(start, r.offset);
  const sigType = r.u8();
  if (sigType !== 0) throw new DelegateDecodeError('only ed25519 signatures are supported');
  const signature = r.bytes(64);
  if (!r.done) throw new DelegateDecodeError('trailing bytes after the signature');
  return {
    senderId,
    receiverId,
    actions,
    nonce,
    maxBlockHeight,
    publicKey: `ed25519:${base58Encode(publicKeyBytes)}`,
    publicKeyBytes,
    signature,
    delegateActionBytes,
    bytes,
  };
}

/** A delegate action carries an action other than FunctionCall (transfer, add key, ...). */
export class DelegateActionNotAllowed extends DelegateDecodeError {
  constructor(readonly tag: number) {
    super(`action ${tag} is not a function call`);
    this.name = 'DelegateActionNotAllowed';
  }
}

/** sha256 of the NEP-461-prefixed delegate action: what the wallet's key signed. */
export function delegateSigningHash(delegateActionBytes: Uint8Array): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(DELEGATE_ACTION_PREFIX);
  return createHash('sha256').update(prefix).update(delegateActionBytes).digest();
}

/** Is the delegate's signature a valid ed25519 signature by its own public key? */
export function verifyDelegateSignature(d: DecodedSignedDelegate): boolean {
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(d.publicKeyBytes).toString('base64url') },
      format: 'jwk',
    });
    return verify(null, delegateSigningHash(d.delegateActionBytes), key, d.signature);
  } catch {
    return false;
  }
}

/** sha256 of the whole SignedDelegate, hex: one delegate is relayed at most once. */
export function delegateId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
