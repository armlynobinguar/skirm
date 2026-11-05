// Pure helpers for S15/S16: credits from yoctoNEAR (bigint only, never floats), dev deposit hashes,
// the allowance reset countdown, ledger row display and UTC dates.
import { fmt } from '@skirm/ui';
import { DEFAULT_CREDITS_PER_NEAR, YOCTO_PER_NEAR, formatNear, parseNear } from '@/lib/constants';
import type { CreditsWithRows, LedgerRow, Me } from '@/lib/api/types';

/**
 * Credits one NEAR buys: the server's rate (`GET /credits` or `GET /me` `creditsPerNear`), else
 * DEFAULT_CREDITS_PER_NEAR until either loads. The deposit response says what was credited.
 */
export function creditsPerNearOf(
  credits?: Pick<CreditsWithRows, 'creditsPerNear'> | null,
  me?: Pick<Me, 'creditsPerNear'> | null,
): number {
  const r = credits?.creditsPerNear ?? me?.creditsPerNear;
  return typeof r === 'number' && Number.isInteger(r) && r > 0 ? r : DEFAULT_CREDITS_PER_NEAR;
}

/** Largest single top-up the form accepts (NEAR); bigger amounts are almost always typos. */
export const MAX_TOPUP_NEAR = 10_000n;

/** floor(yocto × rate / 10^24), all in bigint (Formulas: credits from a top-up). */
export function creditsForYocto(yocto: string | bigint, rate = DEFAULT_CREDITS_PER_NEAR): number {
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  return Number((v * BigInt(rate)) / YOCTO_PER_NEAR);
}

export type AmountCheck = { ok: true; yocto: string; credits: number } | { ok: false; message: string };

/** Validates a typed NEAR amount ("0.5", "2") and converts it to yocto without floats. */
export function checkNearAmount(input: string, rate = DEFAULT_CREDITS_PER_NEAR): AmountCheck {
  const s = input.trim();
  if (!s) return { ok: false, message: 'Enter an amount in NEAR, for example 0.5.' };
  let yocto: bigint;
  try {
    // parseNear is strict (digits, optional 1–24 decimals); a leading "." is accepted here too.
    yocto = BigInt(parseNear(s.startsWith('.') ? `0${s}` : s));
  } catch {
    return { ok: false, message: 'Enter a NEAR amount like 0.5 or 2, with at most 24 decimals.' };
  }
  if (yocto > MAX_TOPUP_NEAR * YOCTO_PER_NEAR)
    return { ok: false, message: `Top up at most ${fmt(Number(MAX_TOPUP_NEAR))} NEAR at a time.` };
  const credits = creditsForYocto(yocto, rate);
  if (credits < 1) return { ok: false, message: 'That is worth less than 1 credit. Enter a larger amount.' };
  // Credits are whole numbers and the server floors: refuse an amount whose remainder would be paid
  // and never credited (it would also be shown rounded in M02, which shows 4 decimals).
  const exact = (BigInt(credits) * YOCTO_PER_NEAR) / BigInt(rate);
  if (exact !== yocto)
    return {
      ok: false,
      message: `Enter a whole number of credits: ${formatNear(exact, 24)} NEAR buys ${fmt(credits)} credits.`,
    };
  return { ok: true, yocto: yocto.toString(), credits };
}

/** Dev-mode receipt: `dev:<yocto>:<nonce>` (the nonce makes each test deposit a new receipt). */
export function devDepositHash(yocto: string, nonce = randomNonce()): string {
  return `dev:${yocto}:${nonce}`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The yocto amount inside a dev hash, or null for a real transaction hash. */
export function yoctoFromDevHash(hash: string | null | undefined): string | null {
  const m = hash ? /^dev:(\d{1,40})(?::[A-Za-z0-9_-]{1,64})?$/.exec(hash) : null;
  return m ? m[1]! : null;
}

/** "9QxR…k2Lm" for a real hash; "dev deposit" for a dev one. */
export function shortHash(hash: string): string {
  if (hash.startsWith('dev:')) return 'dev deposit';
  return hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash;
}

export function explorerTxUrl(hash: string): string | null {
  return hash.startsWith('dev:') ? null : `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
}

/** "5 h 12 m", "12 m", "less than a minute" until `resetAt`. */
export function formatCountdown(resetAt: string, now: number): string {
  const ms = Date.parse(resetAt) - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return 'less than a minute';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "12 Nov 10:43" in UTC. */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return DATE_FMT.format(d).replace(',', '');
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** "10 Nov 2026" in UTC ("Joined", S16). */
export function formatUtcDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : DAY_FMT.format(d);
}

/** "14:02 UTC". */
export function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export interface LedgerDisplay {
  type: string;
  detail: string;
  from: string;
  /** Signed, with separators: "+1,000", "−60", or "33" for a charge (no balance change). */
  amount: string;
  tone: 'in' | 'out' | 'neutral';
}

/**
 * How a ledger row reads (S15 artboard). Amounts are magnitudes; the type gives the direction:
 * topup and refund add, hold and free (a hold on the free allowance) take, charge only records
 * what a hold used (an aborted match's reversal is a charge with a negative amount); spend takes
 * paid credits outside any match (a premium cosmetic). `matchLabel` names the row's match, e.g.
 * "Copper Hollow match"; null reads "Match".
 */
export function ledgerDisplay(
  row: LedgerRow,
  matchLabel: string | null,
  rate: number = DEFAULT_CREDITS_PER_NEAR,
): LedgerDisplay {
  const from = row.source === 'free' ? 'Free allowance' : 'Balance';
  const match = matchLabel ?? 'Match';
  const dir = row.type === 'topup' || row.type === 'refund' ? 1 : row.type === 'charge' ? 0 : -1;
  const signed = dir * row.amount;
  const amount = dir === 0 ? fmt(Math.abs(row.amount)) : `${signed >= 0 ? '+' : '−'}${fmt(Math.abs(signed))}`;
  const tone: LedgerDisplay['tone'] = dir === 0 ? 'neutral' : signed >= 0 ? 'in' : 'out';
  switch (row.type) {
    case 'topup': {
      if (row.note === 'prize') return { type: 'Prize', detail: 'Tournament prize', from, amount, tone };
      if (row.note === 'prize_pool') return { type: 'Refund', detail: 'Tournament cancelled · prize pool returned', from, amount, tone };
      if (row.note === 'backing') return { type: 'Backing', detail: 'Writer backing � raise, royalty share or refund', from, amount, tone };
      if (row.note === 'rental') return { type: 'Rental', detail: 'Your agent was rented � after the 5% fee', from, amount, tone };
      const y = yoctoFromDevHash(row.txHash);
      // Rates can change between deposits: only quote today's rate when it matches what was credited.
      const detail = y
        ? creditsForYocto(y, rate) === row.amount
          ? `${formatNear(y, 24)} NEAR at ${fmt(rate)} credits per NEAR`
          : `${formatNear(y, 24)} NEAR`
        : 'NEAR deposit';
      return {
        type: 'Top-up',
        detail,
        from,
        amount,
        tone,
      };
    }
    case 'hold':
    case 'free':
      return { type: 'Hold', detail: `${match} · held up front`, from, amount, tone };
    case 'charge':
      return {
        type: 'Charge',
        detail:
          row.note === 'entry_fee'
            ? `${match} · entry fee`
            : row.note === 'reversal'
              ? `${match} · charge reversed, match aborted`
              : `${match} · credits used`,
        from,
        amount,
        tone,
      };
    case 'refund':
      return {
        type: 'Refund',
        detail:
          row.note === 'expired'
            ? `${match} · unused, allowance already reset`
            : `${match} · unused credits returned`,
        from,
        amount,
        tone,
      };
    case 'spend':
      return {
        type: 'Purchase',
        detail:
          row.note === 'cosmetic'
            ? 'Premium look'
            : row.note === 'prize_pool'
              ? 'Tournament prize pool'
              : row.note === 'backing'
                ? 'Backed a writer'
                : row.note === 'rental'
                  ? 'Agent rental � one match'
                  : 'Paid credits spent',
        from,
        amount,
        tone,
      };
    default:
      return { type: String(row.type), detail: match, from, amount, tone };
  }
}
