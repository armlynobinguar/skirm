'use client';
// Pure helpers and small hooks shared by the PvP screens (S11, S14) and the v2 match screens.
import { useEffect, useState } from 'react';
import { formatNear } from '@/lib/constants';

/** "1:05" from ms (search time, elapsed). */
export function fmtMinSec(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Re-renders every `ms` while `on`; returns Date.now(). */
export function useNow(ms = 250, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

/** A season place's share of the pool in percent from the season's split (bps); null outside the paid places. */
export function splitShare(splitBps: readonly number[], rank: number): number | null {
  const bps = rank >= 1 ? splitBps[rank - 1] : undefined;
  return bps === undefined ? null : bps / 100;
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * The split as rows for the pool panel: one row per place, with a run of equal shares at the end
 * folded into one ("4th–10th", "5% each").
 */
export function splitRows(splitBps: readonly number[]): [place: string, share: string][] {
  const n = splitBps.length;
  // The run of places sharing the last place's share: start … n − 1.
  let start = n - 1;
  while (start > 0 && splitBps[start - 1] === splitBps[n - 1]) start--;
  if (n - start < 2) start = n; // a run of one is not worth folding
  const rows: [string, string][] = splitBps.slice(0, start).map((b, i) => [ordinal(i + 1), `${b / 100}%`]);
  if (start < n) rows.push([`${ordinal(start + 1)}–${ordinal(n)}`, `${splitBps[n - 1]! / 100}% each`]);
  return rows;
}

/** Time left as "2d 03h 05m" (a day or more) or "3:05:09" (under a day); "0:00:00" once past. */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${h}:${p(m)}:${p(sec)}`;
}

/** Credits as NEAR at the server's rate, 2 decimals: 2,100 at 1,000 per NEAR → "2.10". */
export function creditsAsNear(credits: number, creditsPerNear: number): string {
  return creditsPerNear > 0 ? (credits / creditsPerNear).toFixed(2) : '0.00';
}

/** yoctoNEAR as NEAR with exactly `decimals` places, cut not rounded: 1.84e24 → "1.84", 1e24 → "1.00". */
export function nearFixed(yocto: bigint, decimals = 2): string {
  const [whole, frac = ''] = formatNear(yocto, decimals).split('.');
  return `${whole}.${frac.padEnd(decimals, '0')}`;
}

/** "12.50 NEAR" from a yoctoNEAR string (null or malformed counts as 0). */
export const nearText = (yocto: string | null | undefined) => `${nearFixed(sumYocto(yocto))} NEAR`;

/** The sum of yoctoNEAR strings as a bigint (null, empty and malformed values count as 0). */
export function sumYocto(...values: (string | null | undefined)[]): bigint {
  return values.reduce<bigint>((n, v) => {
    if (!v) return n;
    try {
      return n + BigInt(v);
    } catch {
      return n;
    }
  }, 0n);
}

/** "31×13 to 55×25": the smallest and the largest board of a map list, by tiles. */
export function boardSizeRange(boards: readonly { w: number; h: number }[]): string {
  if (!boards.length) return '';
  const byArea = [...boards].sort((a, b) => a.w * a.h - b.w * b.h);
  const lo = byArea[0]!;
  const hi = byArea[byArea.length - 1]!;
  return `${lo.w}×${lo.h} to ${hi.w}×${hi.h}`;
}
