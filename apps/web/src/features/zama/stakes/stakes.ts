// Confidential cSKIRM stakes on SkirmMatch (packages/fhevm, Sepolia), behind NEXT_PUBLIC_ZAMA_ENABLED.
//
// A staked sealed match escrows an encrypted cSKIRM amount per side, pulled with the seal through
// ERC-7984 confidentialTransferFrom (SkirmMatch must be the player's cSKIRM operator: approveOperator).
// The amount never shows on chain: rivals and spectators see a handle, plus one public yes/no per
// side ("stake ok", opened with the loadouts). The game server settles the result, which anchors
// the log hash and pays every side out by confidential transfer; a player user-decrypts its own
// stake and payout to see what it won or lost (revealPayout).
import { ConfidentialSkirmCreditsAbi, SkirmMatchAbi } from '@skirm/fhevm/generated';
import { Contract, type ContractRunner } from 'ethers';
import { isZeroHandle, userDecrypt, type Hex, type TypedDataSigner } from '@/lib/zama/fhe';
import { trackTx } from '@/lib/zama/steps';

/** cSKIRM has 6 decimals (the ERC-7984 default). */
export const CSKIRM_UNIT = 1_000_000n;

/** How long the operator approval lasts (SkirmMatch may pull a stake only on a seal the player signs). */
export const OPERATOR_APPROVAL_DAYS = 30;

/** How far back the settlement transaction is looked up (about a day of Sepolia blocks). */
export const SETTLE_LOOKBACK_BLOCKS = 7_200;

/** SkirmMatch.NO_SIDE: the winner seat of a draw. */
export const NO_SIDE = 255;

/** "12.5" cSKIRM → 12_500_000n base units; null for anything that is not a non-negative amount with at most 6 decimals. */
export function parseCskirm(text: string): bigint | null {
  const t = text.trim();
  const m = /^(\d{1,13})(?:\.(\d{0,6}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * CSKIRM_UNIT + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

/** SkirmMatch.escrow, as the web reads it. */
export interface ChainEscrow {
  /** Public minimum stake per side (0: unstaked match). */
  minStake: bigint;
  feeBps: number;
  /** Each side's stake handle (decryptable by that side's player). */
  staked: [Hex, Hex];
  /** Each side's payout handle (zero until paid). */
  paid: [Hex, Hex];
  /** The verified "stake ok" flags (false before the reveal is finalized). */
  stakeOk: [boolean, boolean];
}

/** SkirmMatch.settlement plus the transaction that posted it. */
export interface ChainSettlement {
  /** The anchored log head hash (null before settle). */
  logHash: Hex | null;
  /** 'A', 'B' or 'draw' (null before settle). */
  winner: 'A' | 'B' | 'draw' | null;
  settledAt: number;
  /** The settle transaction (null when not settled, or not found in the lookback window). */
  txHash: Hex | null;
}

/** The SkirmMatch / cSKIRM calls the stake feature needs (an interface, so tests can fake the chain). */
export interface StakesApi {
  escrow(key: Hex): Promise<ChainEscrow>;
  settlement(key: Hex): Promise<ChainSettlement>;
}

const ZERO32 = `0x${'0'.repeat(64)}`;
const pair = <T>(v: readonly T[]): [T, T] => [v[0]!, v[1]!];

/** SkirmMatch's escrow and settlement through ethers (reads only). */
export function stakesApi(runner: ContractRunner, matchContract: string): StakesApi {
  const c = new Contract(matchContract, SkirmMatchAbi, runner);
  return {
    async escrow(key) {
      const e = (await c.getFunction('escrow')(key)) as {
        minStake: bigint;
        matchFeeBps: bigint;
        staked: string[];
        paid: string[];
        stakeOkClear: boolean[];
      };
      return {
        minStake: BigInt(e.minStake),
        feeBps: Number(e.matchFeeBps),
        staked: pair(e.staked) as [Hex, Hex],
        paid: pair(e.paid) as [Hex, Hex],
        stakeOk: [!!e.stakeOkClear[0], !!e.stakeOkClear[1]],
      };
    },
    async settlement(key) {
      const s = (await c.getFunction('settlement')(key)) as { logHash: string; winner: bigint; settledAt: bigint };
      if (s.logHash === ZERO32) return { logHash: null, winner: null, settledAt: 0, txHash: null };
      const w = Number(s.winner);
      let txHash: Hex | null = null;
      const provider = c.runner?.provider;
      if (provider) {
        const latest = await provider.getBlockNumber();
        const events = (await c.queryFilter(c.getEvent('MatchSettled')(key), Math.max(0, latest - SETTLE_LOOKBACK_BLOCKS)).catch(() => [])) as {
          transactionHash: string;
        }[];
        txHash = (events[0]?.transactionHash as Hex | undefined) ?? null;
      }
      return { logHash: s.logHash as Hex, winner: w === 0 ? 'A' : w === 1 ? 'B' : 'draw', settledAt: Number(s.settledAt), txHash };
    },
  };
}

type Tx = { wait: () => Promise<unknown> };

/**
 * Makes `spender` (SkirmMatch) a cSKIRM operator for the signer's account, once: a no-op when it
 * already is. ERC-7984 has no allowance; an operator may move any amount until `until`, which is why
 * SkirmMatch only pulls on a seal the player itself submits.
 */
export async function approveOperator(signer: ContractRunner, credits: string, holder: string, spender: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const c = new Contract(credits, ConfidentialSkirmCreditsAbi, signer);
  if ((await c.getFunction('isOperator')(holder, spender)) as boolean) return false;
  await trackTx(() => c.getFunction('setOperator')(spender, nowSec + OPERATOR_APPROVAL_DAYS * 86_400) as Promise<Tx>);
  return true;
}

/** A player's own result in cSKIRM base units. */
export interface Payout {
  staked: bigint;
  paid: bigint;
  /** paid - staked: what the match won (positive) or cost (negative). */
  net: bigint;
}

/**
 * User-decrypts the player's stake and payout (the signer must be the side's player: only it holds
 * ACL access). Null when the side has nothing in escrow or has not been paid yet.
 */
export async function revealPayout(
  instance: Parameters<typeof userDecrypt>[0],
  signer: TypedDataSigner,
  matchContract: string,
  escrow: ChainEscrow,
  side: 0 | 1,
): Promise<Payout | null> {
  const stakedH = escrow.staked[side];
  const paidH = escrow.paid[side];
  if (isZeroHandle(stakedH) || isZeroHandle(paidH)) return null;
  const [staked, paid] = await userDecrypt(instance, signer, [
    { handle: stakedH, contractAddress: matchContract },
    { handle: paidH, contractAddress: matchContract },
  ]);
  if (typeof staked !== 'bigint' || typeof paid !== 'bigint') throw new TypeError('The stake handles are not integer ciphertexts');
  return { staked, paid, net: paid - staked };
}
