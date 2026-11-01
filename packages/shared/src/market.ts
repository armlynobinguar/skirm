// Marketplace sale split in integer yoctoNEAR. Formulas §6.
import { DEFAULTS } from './config';

// ---------- §6 sale split (integer yoctoNEAR) ----------

export const YOCTO_PER_NEAR = 10n ** 24n;
const BPS = 10_000n;

/** Exact decimal NEAR string ("4.75") → yoctoNEAR. */
export function nearToYocto(near: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(near.trim());
  if (!m) throw new RangeError(`not a NEAR amount: ${near}`);
  const frac = (m[2] ?? '').padEnd(24, '0');
  return BigInt(m[1]!) * YOCTO_PER_NEAR + BigInt(frac);
}

/** yoctoNEAR → decimal NEAR string without trailing zeros ("4.5"). */
export function yoctoToNear(yocto: bigint): string {
  const neg = yocto < 0n;
  const abs = neg ? -yocto : yocto;
  const whole = abs / YOCTO_PER_NEAR;
  const frac = (abs % YOCTO_PER_NEAR).toString().padStart(24, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export interface SaleSplit {
  fee: bigint;
  royalty: bigint;
  seller: bigint;
}

export interface SaleOptions {
  /** Primary sale: the creator sells, so no royalty. */
  primary: boolean;
  feeBps?: number;
  /** Creator royalty set at mint, 0 to 1,000 bps. */
  royaltyBps?: number;
}

function bps(value: number, max: number, name: string): bigint {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new RangeError(`${name} must be an integer in 0..${max}, got ${value}`);
  return BigInt(value);
}

/**
 * fee = floor(P·b_f/10⁴), royalty = floor(P·b_r/10⁴) on resale only, seller = P − fee − royalty,
 * so the three parts always add up to P.
 */
export function splitSale(price: bigint, opts: SaleOptions): SaleSplit {
  if (price < 0n) throw new RangeError('price must be ≥ 0');
  const bf = bps(opts.feeBps ?? DEFAULTS.market.feeBps, 10_000, 'feeBps');
  const br = bps(
    opts.royaltyBps ?? DEFAULTS.market.royaltyBps,
    DEFAULTS.market.royaltyMaxBps,
    'royaltyBps',
  );
  const fee = (price * bf) / BPS;
  const royalty = opts.primary ? 0n : (price * br) / BPS;
  return { fee, royalty, seller: price - fee - royalty };
}
