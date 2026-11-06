// Game constants the UI shows before the server is asked. The server stays authoritative.
import { DEFAULTS } from '@skirm/shared';

/** Daily free credits per player (shared DEFAULTS.free.dailyCredits, which the ledger uses too). */
export const DAILY_FREE_ALLOWANCE = DEFAULTS.free.dailyCredits;

/** The three starter agents. */
export const STARTER_AGENTS = ['Rook', 'Wren', 'Moss'] as const;

/**
 * Credits one NEAR buys: the api default (`CREDITS_PER_NEAR`, testnet placeholder). The server's
 * value is `me.creditsPerNear` / `credits.creditsPerNear`; use this only before those load.
 */
export const DEFAULT_CREDITS_PER_NEAR = 1000;

/** 1 NEAR = 10^24 yoctoNEAR. */
export const YOCTO_PER_NEAR = 10n ** 24n;

/**
 * yoctoNEAR string → "1.25" NEAR (up to 4 decimals, trailing zeros trimmed). A non-zero amount
 * under that precision keeps decimals up to its first two significant digits ("0.000052"), so a
 * price never reads as "0 NEAR".
 */
export function formatNear(yocto: string | bigint | null | undefined, decimals = 4): string {
  if (yocto === null || yocto === undefined) return '';
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  const whole = v / YOCTO_PER_NEAR;
  const digits = (v % YOCTO_PER_NEAR).toString().padStart(24, '0');
  let frac = digits.slice(0, decimals).replace(/0+$/, '');
  if (!frac && whole === 0n && v > 0n) {
    const first = digits.search(/[1-9]/);
    frac = digits.slice(0, first + 2).replace(/0+$/, '');
  }
  return frac ? `${whole}.${frac}` : whole.toString();
}

const NEAR_RE = /^(\d+)(?:\.(\d{1,24}))?$/;

/**
 * "1.25" NEAR → yoctoNEAR string, exactly. Strict: digits with an optional "." and 1–24 decimals
 * (surrounding spaces are trimmed). Throws on anything else ("1.2.3", "-1", "1e3", "1,5", ".5", "1.",
 * or more than 24 decimals, which would otherwise be truncated silently).
 */
export function parseNear(near: string): string {
  const m = NEAR_RE.exec(near.trim());
  if (!m) throw new Error('not a NEAR amount');
  const whole = m[1]!;
  const frac = m[2] ?? '';
  return (BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac.padEnd(24, '0'))).toString();
}

/** Most characters of an agent's system prompt (the owner's instructions, PATCH /agents/:id). */
export const AGENT_SYSTEM_PROMPT_MAX = 600;
