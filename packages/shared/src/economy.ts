// v2 free-play budget. Formulas §4 on the v2 cost basis: every credit, paid or free, is spent on
// talk at about the Standard rate, so c is the modeled model cost behind one Standard credit.
import { DEFAULTS } from './config';
import { v2CostPerFreeCredit } from './talk';

export interface FreeBudgetInput {
  /** N: daily active players. */
  players?: number;
  /** φ: share of players who pay. */
  payerShare?: number;
  /** A: spend per paying player, USD per month. */
  spendUsdMonth?: number;
  /** F: marketplace fees, USD per month. */
  feeIncomeUsdMonth?: number;
  /** p: credit price. */
  priceUsd?: number;
  /** c: model cost behind one credit (default v2CostPerFreeCredit). */
  costPerTurn?: number;
  /** X_fix: fixed infrastructure, USD per month. */
  fixedInfraUsdMonth?: number;
}

/** B = NφA + F − (NφA / p)·c − X_fix: monthly money left for free play. */
export function v2FreePlayBudget(input: FreeBudgetInput = {}): number {
  const N = input.players ?? DEFAULTS.model.dailyPlayers;
  const phi = input.payerShare ?? DEFAULTS.model.payerShare;
  const A = input.spendUsdMonth ?? DEFAULTS.model.spendUsdMonth;
  const F = input.feeIncomeUsdMonth ?? DEFAULTS.model.feeIncomeUsdMonth;
  const p = input.priceUsd ?? DEFAULTS.credits.priceUsd;
  const c = input.costPerTurn ?? v2CostPerFreeCredit();
  const Xfix = input.fixedInfraUsdMonth ?? DEFAULTS.model.fixedInfraUsdMonth;
  const revenue = N * phi * A;
  return revenue + F - (revenue / p) * c - Xfix;
}

/** G = floor(σ · B / (D·c)): global daily free budget in credits, never negative. */
export function v2GlobalFreeBudget(
  budget: number = v2FreePlayBudget(),
  costPerCredit: number = v2CostPerFreeCredit(),
  safety: number = DEFAULTS.free.dailyBudgetSafety,
  daysPerMonth: number = DEFAULTS.model.daysPerMonth,
): number {
  return Math.max(0, Math.floor((safety * budget) / (daysPerMonth * costPerCredit)));
}
