// In-memory credits ledger: a pure state machine over integer credits.
// Charging rules: Game Spec §6 (credit_check, settle, abort) and §7 (free allowance);
// prices: Formulas §2 (H, Q, refund) and §3 (price weights).
// Every operation takes the state and a timestamp and returns a new state plus the rows it wrote,
// so the API can persist the same rows to Postgres and rebuild balances from them.
import {
  DEFAULTS,
  ceilEps,
  holdCredits,
  priceWeight,
  v2GlobalFreeBudget,
  type ActionReason,
} from '@skirm/shared';

// ---------- Rows ----------

export type LedgerRowType = 'topup' | 'hold' | 'charge' | 'refund' | 'free' | 'spend';
export type CreditSource = 'paid' | 'free';

/**
 * One journal line. Amounts are whole credits.
 * - topup: paid credits added to the balance.
 * - hold: paid credits moved from the balance into a run's hold (includes the entry fee).
 * - free: daily-allowance credits moved into a run's hold (also counted on the global budget).
 * - charge: credits consumed from a hold (per turn, or the entry fee). Negative only as a
 *   `reversal` when a run is aborted.
 * - refund: credits released from a hold back to where they came from. A free refund after the
 *   00:00 UTC reset is `expired`: the allowance has already been renewed.
 * - spend: paid credits taken from the balance for a purchase outside any run (a `cosmetic`).
 *   Never drawn from the allowance or counted on the global budget.
 * For every closed run: Σ hold + Σ free = Σ charge + Σ refund.
 */
export interface LedgerRow {
  seq: number;
  at: string;
  player: string;
  type: LedgerRowType;
  amount: number;
  source: CreditSource;
  runId?: string;
  /** Deposit receipt for a top-up (credited once per receipt), or what a spend bought. */
  ref?: string;
  note?: LedgerNote;
}

/** What paid credits outside a run bought: a cosmetic, a tournament's prize pool, or a stake in a writer's backing round. */
export type SpendKind = 'cosmetic' | 'prize_pool' | 'backing';
/** A credit that is not a deposit: a tournament prize, a prize pool returned to its creator, or backing money (a raise, a royalty share or a refunded stake). */
export type TopUpKind = 'prize' | 'prize_pool' | 'backing';
export type LedgerNote = 'entry_fee' | 'reversal' | 'expired' | SpendKind | 'prize';

// ---------- State ----------

export interface PlayerAccount {
  /** Paid balance available to spend (not counting credits held by runs). */
  paid: number;
  /** UTC day (YYYY-MM-DD) that `freeUsed` belongs to. */
  freeDay: string;
  /** Allowance credits used or held today. */
  freeUsed: number;
  /** Top-up receipts already credited. */
  topupRefs: Record<string, true>;
}

export type RunHoldStatus = 'held' | 'settled' | 'aborted';

export interface RunHold {
  runId: string;
  player: string;
  status: RunHoldStatus;
  /** UTC day the free part was drawn on. */
  day: string;
  agents: number;
  stepLimit: number;
  /** H = ceil(L·S(n)). */
  hold: number;
  /** Part of H drawn from the daily allowance. */
  freeHeld: number;
  /** Part of H drawn from the paid balance. */
  paidHeld: number;
  /** Pool entry fee, paid balance only; moved to the pool when the hold is placed. */
  entryFee: number;
  /** Whether turns are charged (false for a pool run whose entry fee includes the run). */
  chargesTurns: boolean;
  /** Charged turns per agent in deploy order (t_k). */
  ticks: number[];
  lost: boolean[];
  /** Unweighted count of charged turns (replay `turnsCharged`). */
  turnsCharged: number;
  chargedFree: number;
  chargedPaid: number;
}

export interface LedgerState {
  seq: number;
  players: Record<string, PlayerAccount>;
  runs: Record<string, RunHold>;
  /** Global daily free budget counter, in credits (= one-agent turns). */
  globalFree: { day: string; used: number };
}

export interface LedgerConfig {
  /** Daily free allowance per player, credits. */
  freeAllowance: number;
  /** G: global daily free budget, credits. */
  globalFreeBudget: number;
  maxAgents: number;
  extraAgentStep: number;
}

export const DEFAULT_LEDGER_CONFIG: Readonly<LedgerConfig> = Object.freeze({
  freeAllowance: DEFAULTS.free.dailyCredits,
  globalFreeBudget: v2GlobalFreeBudget(),
  maxAgents: DEFAULTS.crew.maxAgents,
  extraAgentStep: DEFAULTS.crew.extraAgentStep,
});

export function emptyLedger(): LedgerState {
  return { seq: 0, players: {}, runs: {}, globalFree: { day: '', used: 0 } };
}

// ---------- Results ----------

export type LedgerError =
  | 'invalid_amount'
  | 'invalid_crew'
  | 'invalid_agent'
  | 'duplicate_topup'
  | 'duplicate_run'
  | 'unknown_run'
  | 'run_closed'
  | 'insufficient_credits'
  | 'free_budget_exhausted'
  | 'agent_lost'
  | 'hold_exceeded';

export type LedgerResult =
  | { ok: true; state: LedgerState; rows: LedgerRow[] }
  | {
      ok: false;
      state: LedgerState;
      rows: [];
      error: LedgerError;
      message: string;
      /** insufficient_credits from `spend`: credits needed vs. paid credits available. */
      need?: number;
      have?: number;
    };

function fail(state: LedgerState, error: LedgerError, message: string): LedgerResult {
  return { ok: false, state, rows: [], error, message };
}

// ---------- Helpers ----------

/** UTC day key; the allowance and the global budget reset at 00:00 UTC. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const isWhole = (x: number) => Number.isSafeInteger(x) && x >= 0;

function account(state: LedgerState, player: string, day: string): PlayerAccount {
  const a = state.players[player];
  if (!a) return { paid: 0, freeDay: day, freeUsed: 0, topupRefs: {} };
  return a.freeDay === day ? a : { ...a, freeDay: day, freeUsed: 0 };
}

function globalUsed(state: LedgerState, day: string): number {
  return state.globalFree.day === day ? state.globalFree.used : 0;
}

/** Builds rows with increasing seq numbers. */
class RowWriter {
  rows: LedgerRow[] = [];
  constructor(
    public seq: number,
    private at: string,
    private player: string,
  ) {}
  add(row: Omit<LedgerRow, 'seq' | 'at' | 'player'>): void {
    if (row.amount === 0) return;
    this.rows.push({ seq: ++this.seq, at: this.at, player: this.player, ...row });
  }
}

// ---------- Views ----------

export interface Balance {
  paid: number;
  /** Allowance left today (before the global budget cap). */
  freeLeft: number;
  /** Credits held by open runs (free + paid, entry fees excluded: they are already charged). */
  held: number;
  /** What a hold can draw on right now: paid + min(freeLeft, global budget left). */
  available: number;
}

export function balanceOf(
  state: LedgerState,
  player: string,
  now: number,
  config: LedgerConfig = DEFAULT_LEDGER_CONFIG,
): Balance {
  const day = utcDay(now);
  const a = account(state, player, day);
  const freeLeft = Math.max(0, config.freeAllowance - a.freeUsed);
  let held = 0;
  for (const r of Object.values(state.runs)) {
    if (r.player === player && r.status === 'held') held += r.hold - r.chargedFree - r.chargedPaid;
  }
  return {
    paid: a.paid,
    freeLeft,
    held,
    available: a.paid + Math.min(freeLeft, freeBudgetLeft(state, now, config)),
  };
}

export function freeBudgetLeft(
  state: LedgerState,
  now: number,
  config: LedgerConfig = DEFAULT_LEDGER_CONFIG,
): number {
  return Math.max(0, config.globalFreeBudget - globalUsed(state, utcDay(now)));
}

// ---------- Operations ----------

export interface TopUpInput {
  player: string;
  credits: number;
  /** Deposit receipt id; a receipt is credited once. */
  ref?: string;
  /** Not a deposit: a tournament prize or a returned prize pool (its `ref` is still credited once). */
  note?: TopUpKind;
}

export function topUp(state: LedgerState, input: TopUpInput, now: number): LedgerResult {
  const { player, credits, ref } = input;
  if (!isWhole(credits) || credits === 0)
    return fail(state, 'invalid_amount', `top-up must be a whole number > 0, got ${credits}`);
  const day = utcDay(now);
  const a = account(state, player, day);
  if (ref !== undefined && a.topupRefs[ref])
    return fail(state, 'duplicate_topup', `receipt ${ref} already credited`);
  const w = new RowWriter(state.seq, new Date(now).toISOString(), player);
  w.add({ type: 'topup', amount: credits, source: 'paid', ...(ref !== undefined ? { ref } : {}), ...(input.note ? { note: input.note } : {}) });
  const next: PlayerAccount = {
    ...a,
    paid: a.paid + credits,
    topupRefs: ref !== undefined ? { ...a.topupRefs, [ref]: true } : a.topupRefs,
  };
  return {
    ok: true,
    state: { ...state, seq: w.seq, players: { ...state.players, [player]: next } },
    rows: w.rows,
  };
}

export interface SpendInput {
  player: string;
  amount: number;
  /** What was bought (e.g. `cosmetic:outfit_gold`). */
  ref: string;
  kind?: SpendKind;
}

/**
 * A purchase with paid credits only: the free allowance and the global budget are never touched.
 * Rejected (nothing changes) when the paid balance is short.
 */
export function spend(state: LedgerState, input: SpendInput, now: number): LedgerResult {
  const { player, amount, ref } = input;
  if (!isWhole(amount) || amount === 0)
    return fail(state, 'invalid_amount', `spend must be a whole number > 0, got ${amount}`);
  const day = utcDay(now);
  const a = account(state, player, day);
  if (amount > a.paid)
    return {
      ok: false,
      state,
      rows: [],
      error: 'insufficient_credits',
      message: `needs ${amount} paid credits; ${a.paid} available`,
      need: amount,
      have: a.paid,
    };
  const w = new RowWriter(state.seq, new Date(now).toISOString(), player);
  w.add({ type: 'spend', amount, source: 'paid', ref, note: input.kind ?? 'cosmetic' });
  return {
    ok: true,
    state: {
      ...state,
      seq: w.seq,
      players: { ...state.players, [player]: { ...a, paid: a.paid - amount } },
    },
    rows: w.rows,
  };
}

export interface PlaceHoldInput {
  player: string;
  runId: string;
  stepLimit: number;
  agents: number;
  /** Pool entry fee in credits (0 or omitted for a run outside a reward pool). */
  entryFee?: number;
  /** Draw on the daily free allowance first (default true). */
  useAllowance?: boolean;
}

/**
 * credit_check + planning: hold H = ceil(L·S(n)), allowance first, then paid balance; plus the
 * entry fee from the paid balance, charged at once (moved to the pool). Rejected = nothing changes.
 */
export function placeHold(
  state: LedgerState,
  input: PlaceHoldInput,
  now: number,
  config: LedgerConfig = DEFAULT_LEDGER_CONFIG,
): LedgerResult {
  const { player, runId, stepLimit, agents } = input;
  const entryFee = input.entryFee ?? 0;
  if (!Number.isInteger(agents) || agents < 1 || agents > config.maxAgents) {
    return fail(state, 'invalid_crew', `crew size must be 1..${config.maxAgents}, got ${agents}`);
  }
  if (!isWhole(stepLimit) || stepLimit === 0)
    return fail(state, 'invalid_amount', `step limit must be > 0, got ${stepLimit}`);
  if (!isWhole(entryFee))
    return fail(state, 'invalid_amount', `entry fee must be a whole number ≥ 0, got ${entryFee}`);
  if (state.runs[runId]) return fail(state, 'duplicate_run', `run ${runId} already has a hold`);

  const day = utcDay(now);
  const a = account(state, player, day);
  const H = holdCredits(stepLimit, agents, config.extraAgentStep);
  const allowanceLeft =
    input.useAllowance === false ? 0 : Math.max(0, config.freeAllowance - a.freeUsed);
  const budgetLeft = Math.max(0, config.globalFreeBudget - globalUsed(state, day));
  const freePart = Math.min(H, allowanceLeft, budgetLeft);
  const paidPart = H - freePart;
  if (paidPart + entryFee > a.paid) {
    const budgetBound = budgetLeft < Math.min(H, allowanceLeft);
    return fail(
      state,
      budgetBound ? 'free_budget_exhausted' : 'insufficient_credits',
      `hold needs ${H + entryFee} credits; ${freePart} free + ${a.paid} paid available`,
    );
  }

  const w = new RowWriter(state.seq, new Date(now).toISOString(), player);
  w.add({ type: 'free', amount: freePart, source: 'free', runId });
  w.add({ type: 'hold', amount: paidPart + entryFee, source: 'paid', runId });
  w.add({ type: 'charge', amount: entryFee, source: 'paid', runId, note: 'entry_fee' });

  const run: RunHold = {
    runId,
    player,
    status: 'held',
    day,
    agents,
    stepLimit,
    hold: H,
    freeHeld: freePart,
    paidHeld: paidPart,
    entryFee,
    chargesTurns: entryFee === 0,
    ticks: Array.from({ length: agents }, () => 0),
    lost: Array.from({ length: agents }, () => false),
    turnsCharged: 0,
    chargedFree: 0,
    chargedPaid: 0,
  };
  return {
    ok: true,
    state: {
      seq: w.seq,
      players: {
        ...state.players,
        [player]: { ...a, paid: a.paid - paidPart - entryFee, freeUsed: a.freeUsed + freePart },
      },
      runs: { ...state.runs, [runId]: run },
      globalFree: { day, used: globalUsed(state, day) + freePart },
    },
    rows: w.rows,
  };
}

export interface TurnOutcome {
  /** Agent index in deploy order (0 = first agent, weight 1). */
  agent: number;
  /** The replay `reason` for this agent's action this tick. */
  reason: ActionReason;
}

/** Spec §6 / Q16: a decision requested from a living agent is charged (timeouts and illegal picks
 * included); provider errors and lost agents are not. */
export function isChargedTurn(reason: ActionReason): boolean {
  return reason !== 'error' && reason !== 'lost';
}

/**
 * Charges the turns of one tick. The running charge is ceil(Σ m_k·t_k), so each row adds the
 * whole credits the weighted total has crossed and the rows of a run sum to Q. Allowance credits
 * in the hold are spent before paid ones. All-or-nothing per call.
 */
export function chargeTurns(
  state: LedgerState,
  input: { runId: string; turns: readonly TurnOutcome[] },
  now: number,
  config: LedgerConfig = DEFAULT_LEDGER_CONFIG,
): LedgerResult {
  const run = state.runs[input.runId];
  if (!run) return fail(state, 'unknown_run', `no hold for run ${input.runId}`);
  if (run.status !== 'held') return fail(state, 'run_closed', `run ${run.runId} is ${run.status}`);

  const ticks = [...run.ticks];
  const lost = [...run.lost];
  let turnsCharged = run.turnsCharged;
  for (const { agent, reason } of input.turns) {
    if (!Number.isInteger(agent) || agent < 0 || agent >= run.agents) {
      return fail(state, 'invalid_agent', `run ${run.runId} has no agent ${agent}`);
    }
    if (reason === 'lost') {
      lost[agent] = true;
      continue;
    }
    if (lost[agent])
      return fail(
        state,
        'agent_lost',
        `agent ${agent} of run ${run.runId} is lost and stops charging`,
      );
    if (!isChargedTurn(reason)) continue;
    ticks[agent]! += 1;
    turnsCharged++;
  }

  let weighted = 0;
  ticks.forEach((t, i) => (weighted += priceWeight(i + 1, config.extraAgentStep) * t));
  const owed = run.chargesTurns ? ceilEps(weighted) : 0;
  if (owed > run.hold)
    return fail(
      state,
      'hold_exceeded',
      `charge ${owed} exceeds hold ${run.hold} for run ${run.runId}`,
    );

  const delta = owed - run.chargedFree - run.chargedPaid;
  const fromFree = Math.min(delta, run.freeHeld - run.chargedFree);
  const fromPaid = delta - fromFree;
  const w = new RowWriter(state.seq, new Date(now).toISOString(), run.player);
  w.add({ type: 'charge', amount: fromFree, source: 'free', runId: run.runId });
  w.add({ type: 'charge', amount: fromPaid, source: 'paid', runId: run.runId });

  const next: RunHold = {
    ...run,
    ticks,
    lost,
    turnsCharged,
    chargedFree: run.chargedFree + fromFree,
    chargedPaid: run.chargedPaid + fromPaid,
  };
  return {
    ok: true,
    state: { ...state, seq: w.seq, runs: { ...state.runs, [run.runId]: next } },
    rows: w.rows,
  };
}

/** Puts released credits back: paid to the balance, free to today's allowance and budget unless the day rolled over. */
function release(
  state: LedgerState,
  run: RunHold,
  w: RowWriter,
  freeBack: number,
  paidBack: number,
  now: number,
): Pick<LedgerState, 'players' | 'globalFree'> {
  const day = utcDay(now);
  const a = account(state, run.player, day);
  const sameDay = run.day === day;
  w.add({
    type: 'refund',
    amount: freeBack,
    source: 'free',
    runId: run.runId,
    ...(sameDay ? {} : { note: 'expired' as const }),
  });
  w.add({ type: 'refund', amount: paidBack, source: 'paid', runId: run.runId });
  const g = globalUsed(state, day);
  return {
    players: {
      ...state.players,
      [run.player]: {
        ...a,
        paid: a.paid + paidBack,
        freeUsed: sameDay ? Math.max(0, a.freeUsed - freeBack) : a.freeUsed,
      },
    },
    globalFree: { day, used: sameDay ? Math.max(0, g - freeBack) : g },
  };
}

export interface SettleResult {
  /** Q: credits charged for turns. */
  charged: number;
  /** H − Q. */
  refunded: number;
  turnsCharged: number;
}

/** ended: charge Q (already charged turn by turn) and release the rest of the hold. The entry fee stays in the pool. */
export function settle(state: LedgerState, input: { runId: string }, now: number): LedgerResult {
  const run = state.runs[input.runId];
  if (!run) return fail(state, 'unknown_run', `no hold for run ${input.runId}`);
  if (run.status !== 'held') return fail(state, 'run_closed', `run ${run.runId} is ${run.status}`);
  const w = new RowWriter(state.seq, new Date(now).toISOString(), run.player);
  const released = release(
    state,
    run,
    w,
    run.freeHeld - run.chargedFree,
    run.paidHeld - run.chargedPaid,
    now,
  );
  return {
    ok: true,
    state: {
      seq: w.seq,
      ...released,
      runs: { ...state.runs, [run.runId]: { ...run, status: 'settled' } },
    },
    rows: w.rows,
  };
}

/** aborted: full refund of the hold and the entry fee. Charges so far are reversed. */
export function abort(state: LedgerState, input: { runId: string }, now: number): LedgerResult {
  const run = state.runs[input.runId];
  if (!run) return fail(state, 'unknown_run', `no hold for run ${input.runId}`);
  if (run.status !== 'held') return fail(state, 'run_closed', `run ${run.runId} is ${run.status}`);
  const w = new RowWriter(state.seq, new Date(now).toISOString(), run.player);
  w.add({
    type: 'charge',
    amount: -run.chargedFree,
    source: 'free',
    runId: run.runId,
    note: 'reversal',
  });
  w.add({
    type: 'charge',
    amount: -run.chargedPaid,
    source: 'paid',
    runId: run.runId,
    note: 'reversal',
  });
  w.add({
    type: 'charge',
    amount: -run.entryFee,
    source: 'paid',
    runId: run.runId,
    note: 'reversal',
  });
  const released = release(state, run, w, run.freeHeld, run.paidHeld + run.entryFee, now);
  return {
    ok: true,
    state: {
      seq: w.seq,
      ...released,
      runs: { ...state.runs, [run.runId]: { ...run, status: 'aborted' } },
    },
    rows: w.rows,
  };
}

/** Running Q, refund (0 until the run closes) and charged turn count. An aborted run charges nothing. */
export function runSummary(state: LedgerState, runId: string): SettleResult | undefined {
  const run = state.runs[runId];
  if (!run) return undefined;
  const charged = run.chargedFree + run.chargedPaid;
  if (run.status === 'aborted')
    return { charged: 0, refunded: run.hold + run.entryFee, turnsCharged: run.turnsCharged };
  return {
    charged,
    refunded: run.status === 'settled' ? run.hold - charged : 0,
    turnsCharged: run.turnsCharged,
  };
}

// ---------- Rebuilding from rows ----------

/** Paid balance and today's allowance use per player, recomputed from the journal alone. */
export function balancesFromRows(
  rows: readonly LedgerRow[],
  day: string,
): Record<string, { paid: number; freeUsed: number }> {
  const out: Record<string, { paid: number; freeUsed: number }> = {};
  for (const r of rows) {
    const b = (out[r.player] ??= { paid: 0, freeUsed: 0 });
    if (r.source === 'paid') {
      if (r.type === 'topup' || r.type === 'refund') b.paid += r.amount;
      else if (r.type === 'hold' || r.type === 'spend') b.paid -= r.amount;
    } else if (r.at.slice(0, 10) === day) {
      if (r.type === 'free') b.freeUsed += r.amount;
      else if (r.type === 'refund' && r.note !== 'expired') b.freeUsed -= r.amount;
    }
  }
  return out;
}
