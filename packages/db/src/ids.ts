// Server-issued ids: `<prefix>_` + ULID (Crockford base32, 48-bit ms time + 80 random bits).
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A 26-char ULID. Monotonic within a process for ids made in the same millisecond. */
export function ulid(now: number = Date.now()): string {
  let rand: Uint8Array;
  if (now === lastTime && lastRand) {
    rand = increment(lastRand);
  } else {
    rand = randomBytes(10);
  }
  lastTime = now;
  lastRand = rand;
  return encodeTime(now) + encodeRandom(rand);
}

let lastTime = -1;
let lastRand: Uint8Array | undefined;

function increment(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]! < 255) {
      out[i]! += 1;
      return out;
    }
    out[i] = 0;
  }
  return randomBytes(10);
}

function encodeTime(ms: number): string {
  let s = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    s = ALPHABET[t % 32]! + s;
    t = Math.floor(t / 32);
  }
  return s;
}

function encodeRandom(bytes: Uint8Array): string {
  // 80 bits → 16 base32 chars.
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 16; i++) {
    s = ALPHABET[Number(bits & 31n)]! + s;
    bits >>= 5n;
  }
  return s;
}

export type IdPrefix =
  'acc' | 'agt' | 'unl' | 'skl' | 'run' | 'mat' | 'lst' | 'sal' | 'bdg' | 'ssn' | 'trl' | 'rof' | 'rnt' | 'bnr';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

export const ID_PATTERN = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;
