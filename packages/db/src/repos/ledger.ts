// Postgres-backed credits ledger. Applies the SAME rules as @skirm/ledger: each operation loads the
// slice of state it touches (account row, run hold, today's global free budget) FOR UPDATE, runs the
// pure state machine, then persists the new state and the journal rows in one transaction.
// Game Spec §6 (credit_check, settle, abort), §7 (free allowance); Formulas §2–§4.
import { and, desc, eq, like, lt, or, sql } from 'drizzle-orm';
import {
  DEFAULT_LEDGER_CONFIG,
  abort as pureAbort,
  balanceOf,
  chargeTurns as pureChargeTurns,
  placeHold as purePlaceHold,
  runSummary,
  settle as pureSettle,
  spend as pureSpend,
  topUp as pureTopUp,
  type LedgerConfig,
  type LedgerError,
  type LedgerResult,
  type LedgerRow as PureRow,
  type LedgerState,
  type PlaceHoldInput,
  type PlayerAccount,
  type RunHold,
  type SettleResult,
  type SpendKind,
  type TopUpKind,
  type TurnOutcome,
} from '@skirm/ledger';
import { holdCredits } from '@skirm/shared';
import type { Executor } from '../client';
import { freeBudgetDays, ledgerAccounts, ledgerRows, runHolds, v2Matches } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, nextUtcMidnight, rowsOf, tx, utcDay, type Clock } from './util';

export type LedgerRowRecord = typeof ledgerRows.$inferSelect;

/** Largest paid balance the int4 `ledger_accounts.balance` column holds. */
export const MAX_BALANCE = 2_147_483_647;

export type LedgerOpResult =
  | { ok: true; rows: LedgerRowRecord[]; hold?: RunHold }
  | {
      ok: false;
      error: LedgerError | 'unknown_account';
      message: string;
      /** insufficient_credits / free_budget_exhausted: credits the hold (or spend) needs vs. can draw. */
      need?: number;
      have?: number;
    };

export interface CreditsView {
  /** Paid balance. */
  balance: number;
  /** Credits held by open runs. */
  held: number;
  /** Free allowance left today (before the global budget cap). */
  allowanceLeft: number;
  /** Next 00:00 UTC. */
  allowanceResetAt: string;
  /** What a hold can draw on now: balance + min(allowanceLeft, global budget left). */
  available: number;
}

export interface LedgerRepoOptions {
  config?: Partial<LedgerConfig>;
  clock?: Clock;
}

interface Slice {
  accountId: string;
  account: typeof ledgerAccounts.$inferSelect;
  hold?: RunHold;
  global?: { day: string; used: number };
}

export class LedgerRepo {
  readonly config: LedgerConfig;
  private readonly clock: Clock;

  constructor(
    private readonly db: Executor,
    opts: LedgerRepoOptions = {},
  ) {
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...opts.config };
    this.clock = opts.clock ?? (() => Date.now());
  }

  // ---------- Operations ----------

  /** credit_check: hold H = ceil(L·S(n)), allowance first, then paid. */
  async hold(
    input: Omit<PlaceHoldInput, 'player'> & { accountId: string },
  ): Promise<LedgerOpResult> {
    const { accountId, ...rest } = input;
    let result: LedgerOpResult;
    try {
      // Loads any existing hold for this run id (whoever owns it), so the pure placeHold
      // returns duplicate_run instead of overwriting it.
      result = await this.apply(
        accountId,
        input.runId,
        true,
        (state, now) => purePlaceHold(state, { ...rest, player: accountId }, now, this.config),
        { foreignHold: true },
      );
    } catch (err) {
      // A concurrent hold for the same run id by another account committed first.
      if (isUniqueViolation(err))
        return {
          ok: false,
          error: 'duplicate_run',
          message: `run ${input.runId} already has a hold`,
        };
      throw err;
    }
    if (
      !result.ok &&
      (result.error === 'insufficient_credits' || result.error === 'free_budget_exhausted')
    ) {
      const b = await this.balance(accountId);
      const H = holdCredits(input.stepLimit, input.agents, this.config.extraAgentStep);
      return { ...result, need: H + (input.entryFee ?? 0), have: b.available };
    }
    return result;
  }

  /** Charges one tick's turns of a run (allowance credits in the hold first). */
  async chargeTurns(runId: string, turns: readonly TurnOutcome[]): Promise<LedgerOpResult> {
    const accountId = await this.holdOwner(runId);
    if (!accountId) return { ok: false, error: 'unknown_run', message: `no hold for run ${runId}` };
    return this.apply(accountId, runId, false, (state, now) =>
      pureChargeTurns(state, { runId, turns }, now, this.config),
    );
  }

  /** ended: keep Q, release the rest of the hold. */
  async settle(runId: string): Promise<LedgerOpResult & { summary?: SettleResult }> {
    const accountId = await this.holdOwner(runId);
    if (!accountId) return { ok: false, error: 'unknown_run', message: `no hold for run ${runId}` };
    return this.apply(accountId, runId, true, (state, now) => pureSettle(state, { runId }, now));
  }

  /** aborted: full refund of the hold and entry fee; charges so far are reversed. */
  async abort(runId: string): Promise<LedgerOpResult & { summary?: SettleResult }> {
    const accountId = await this.holdOwner(runId);
    if (!accountId) return { ok: false, error: 'unknown_run', message: `no hold for run ${runId}` };
    return this.apply(accountId, runId, true, (state, now) => pureAbort(state, { runId }, now));
  }

  /** Paid credits from a verified deposit. A receipt (tx hash) is credited once, ever. */
  async topUp(input: {
    accountId: string;
    credits: number;
    receipt?: string;
    /** Not a deposit: a tournament prize or a returned prize pool. */
    note?: TopUpKind;
  }): Promise<LedgerOpResult> {
    if (input.receipt !== undefined && (await this.receiptCredited(input.receipt)))
      return { ok: false, error: 'duplicate_topup', message: `receipt already credited` };
    try {
      return await this.apply(input.accountId, undefined, false, (state, now) => {
        // Balances are int4 columns: refuse a top-up that would overflow instead of failing
        // the transaction with a raw "integer out of range" error.
        const paid = state.players[input.accountId]?.paid ?? 0;
        if (Number.isSafeInteger(input.credits) && paid + input.credits > MAX_BALANCE)
          return {
            ok: false,
            state,
            rows: [],
            error: 'invalid_amount',
            message: `balance cannot exceed ${MAX_BALANCE} credits`,
          };
        return pureTopUp(
          state,
          {
            player: input.accountId,
            credits: input.credits,
            ...(input.receipt !== undefined ? { ref: input.receipt } : {}),
            ...(input.note ? { note: input.note } : {}),
          },
          now,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err))
        return { ok: false, error: 'duplicate_topup', message: `receipt already credited` };
      throw err;
    }
  }

  /**
   * Paid credits for a purchase outside any run (a cosmetic): never the free allowance or the
   * global budget. Refused with insufficient_credits { need, have } when the paid balance is short.
   * Runs as a savepoint when the repo is bound to a transaction, so a caller can undo it.
   */
  async spend(input: {
    accountId: string;
    amount: number;
    /** What was bought (`cosmetic:<item>`); stored in the row's run_id. */
    ref: string;
    kind?: SpendKind;
  }): Promise<LedgerOpResult> {
    return this.apply(input.accountId, undefined, false, (state, now) =>
      pureSpend(
        state,
        {
          player: input.accountId,
          amount: input.amount,
          ref: input.ref,
          ...(input.kind ? { kind: input.kind } : {}),
        },
        now,
      ),
    );
  }

  // ---------- Reads ----------

  async balance(accountId: string): Promise<CreditsView> {
    const now = this.clock();
    const day = utcDay(now);
    const [acc] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.accountId, accountId));
    const [g] = await this.db.select().from(freeBudgetDays).where(eq(freeBudgetDays.day, day));
    const holds = await this.db
      .select()
      .from(runHolds)
      .where(and(eq(runHolds.accountId, accountId), eq(runHolds.status, 'held')));
    const state: LedgerState = {
      seq: 0,
      players: acc ? { [accountId]: this.playerOf(acc, day) } : {},
      runs: Object.fromEntries(holds.map((h) => [h.runId, toHold(h)])),
      globalFree: { day, used: g?.used ?? 0 },
    };
    const b = balanceOf(state, accountId, now, this.config);
    return {
      balance: b.paid,
      held: b.held,
      allowanceLeft: b.freeLeft,
      allowanceResetAt: nextUtcMidnight(now),
      available: b.available,
    };
  }

  /** Global free budget left today (credits). */
  async freeBudgetLeft(): Promise<number> {
    const day = utcDay(this.clock());
    const [g] = await this.db.select().from(freeBudgetDays).where(eq(freeBudgetDays.day, day));
    return Math.max(0, this.config.globalFreeBudget - (g?.used ?? 0));
  }

  async rows(accountId: string, limit = 50): Promise<LedgerRowRecord[]> {
    return this.db
      .select()
      .from(ledgerRows)
      .where(eq(ledgerRows.accountId, accountId))
      .orderBy(desc(ledgerRows.id))
      .limit(limit);
  }

  /**
   * Paid credits charged for the account's v2 matches, net of reversals: the charge rows on each
   * crew's match hold (`<matchId>-A` / `-B`). Free allowance is left out, as it cost nothing.
   */
  async v2MatchSpend(accountId: string): Promise<number> {
    const res = await this.db.execute<{ spent: number | string | null }>(sql`
      select coalesce(sum(r.amount), 0) as spent
      from ${ledgerRows} r
      where r.account_id = ${accountId} and r.type = 'charge' and r.source = 'paid'
        and exists (
          select 1 from ${v2Matches} m
          where (m.team_a_account_id = ${accountId} and r.run_id = m.id || '-A')
             or (m.team_b_account_id = ${accountId} and r.run_id = m.id || '-B')
        )`);
    return Number(rowsOf<{ spent: number | string | null }>(res)[0]?.spent ?? 0);
  }

  async runRows(runId: string): Promise<LedgerRowRecord[]> {
    return this.db
      .select()
      .from(ledgerRows)
      .where(eq(ledgerRows.runId, runId))
      .orderBy(ledgerRows.id);
  }

  /**
   * Run ids of holds still `held` that were placed before `before` and whose id starts with one of
   * `prefixes`. Used to find holds a crashed or stalled job never settled or aborted.
   */
  async staleHolds(prefixes: readonly string[], before: Date, limit = 200): Promise<string[]> {
    if (!prefixes.length) return [];
    const rows = await this.db
      .select({ runId: runHolds.runId })
      .from(runHolds)
      .where(
        and(
          eq(runHolds.status, 'held'),
          lt(runHolds.createdAt, before),
          or(...prefixes.map((p) => like(runHolds.runId, `${p}%`))),
        ),
      )
      .orderBy(runHolds.createdAt)
      .limit(limit);
    return rows.map((r) => r.runId);
  }

  async getHold(runId: string): Promise<RunHold | undefined> {
    const [h] = await this.db.select().from(runHolds).where(eq(runHolds.runId, runId));
    return h ? toHold(h) : undefined;
  }

  /** Running Q, refund and charged turns (Formulas §2), as @skirm/ledger reports them. */
  async summary(runId: string): Promise<SettleResult | undefined> {
    const h = await this.getHold(runId);
    if (!h) return undefined;
    return runSummary(
      { seq: 0, players: {}, runs: { [runId]: h }, globalFree: { day: '', used: 0 } },
      runId,
    );
  }

  async receiptCredited(receipt: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: ledgerRows.id })
      .from(ledgerRows)
      .where(and(eq(ledgerRows.txHash, receipt), eq(ledgerRows.type, 'topup')));
    return !!row;
  }

  // ---------- Core ----------

  private async holdOwner(runId: string): Promise<string | undefined> {
    const [h] = await this.db
      .select({ accountId: runHolds.accountId })
      .from(runHolds)
      .where(eq(runHolds.runId, runId));
    return h?.accountId;
  }

  private playerOf(acc: typeof ledgerAccounts.$inferSelect, today: string): PlayerAccount {
    const sameDay = acc.allowanceDay === today;
    return {
      paid: acc.balance,
      freeDay: sameDay ? acc.allowanceDay : today,
      freeUsed: sameDay ? Math.max(0, this.config.freeAllowance - acc.allowanceLeft) : 0,
      topupRefs: {},
    };
  }

  /**
   * Lock order (always the same, so concurrent operations cannot deadlock):
   * ledger_accounts → run_holds → free_budget_days.
   */
  private async apply(
    accountId: string,
    runId: string | undefined,
    useGlobal: boolean,
    op: (state: LedgerState, now: number) => LedgerResult,
    opts: { foreignHold?: boolean } = {},
  ): Promise<LedgerOpResult & { summary?: SettleResult }> {
    return tx(this.db, async (t) => {
      const now = this.clock();
      const day = utcDay(now);
      const slice = await this.load(t, accountId, runId, useGlobal, day, opts.foreignHold ?? false);
      if (!slice)
        return {
          ok: false as const,
          error: 'unknown_account' as const,
          message: 'no ledger account',
        };

      const state: LedgerState = {
        seq: 0,
        players: { [accountId]: this.playerOf(slice.account, day) },
        runs: slice.hold ? { [slice.hold.runId]: slice.hold } : {},
        globalFree: slice.global ?? { day, used: 0 },
      };
      const result = op(state, now);
      if (!result.ok)
        return {
          ok: false as const,
          error: result.error,
          message: result.message,
          ...(result.need !== undefined ? { need: result.need, have: result.have } : {}),
        };

      const next = result.state;
      const player = next.players[accountId]!;
      await t
        .update(ledgerAccounts)
        .set({
          balance: player.paid,
          allowanceLeft: Math.max(0, this.config.freeAllowance - player.freeUsed),
          allowanceDay: player.freeDay,
          updatedAt: new Date(now),
        })
        .where(eq(ledgerAccounts.accountId, accountId));

      // Persist the touched hold: update the loaded one, or insert a new one. The insert has no
      // ON CONFLICT clause, so a hold for a run id that already exists can never be overwritten.
      let touched: RunHold | undefined;
      for (const h of Object.values(next.runs)) {
        if (slice.hold && h === slice.hold) continue;
        touched = h;
        if (slice.hold && slice.hold.runId === h.runId) {
          await t
            .update(runHolds)
            .set({ ...fromHold(h), updatedAt: new Date(now) })
            .where(and(eq(runHolds.runId, h.runId), eq(runHolds.accountId, accountId)));
        } else {
          await t.insert(runHolds).values({ ...fromHold(h), accountId });
        }
      }

      if (
        useGlobal &&
        (next.globalFree.day !== state.globalFree.day ||
          next.globalFree.used !== state.globalFree.used)
      ) {
        await t
          .update(freeBudgetDays)
          .set({ used: next.globalFree.used })
          .where(eq(freeBudgetDays.day, next.globalFree.day));
      }

      const inserted = result.rows.length
        ? await t
            .insert(ledgerRows)
            .values(result.rows.map((r) => toRowInsert(r, now)))
            .returning()
        : [];

      // `held` = credits still held by this account's open runs.
      await t
        .update(ledgerAccounts)
        .set({
          held: sql`coalesce((select sum(${runHolds.hold} - ${runHolds.chargedFree} - ${runHolds.chargedPaid}) from ${runHolds} where ${runHolds.accountId} = ${accountId} and ${runHolds.status} = 'held'), 0)`,
        })
        .where(eq(ledgerAccounts.accountId, accountId));

      const summary =
        touched && touched.status !== 'held' ? runSummary(next, touched.runId) : undefined;

      return {
        ok: true as const,
        rows: inserted,
        ...(touched ? { hold: touched } : {}),
        ...(summary ? { summary } : {}),
      };
    });
  }

  private async load(
    t: Executor,
    accountId: string,
    runId: string | undefined,
    useGlobal: boolean,
    day: string,
    foreignHold: boolean,
  ): Promise<Slice | undefined> {
    const [account] = await t
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.accountId, accountId))
      .for('update');
    if (!account) return undefined;
    let hold: RunHold | undefined;
    if (runId) {
      const [h] = await t.select().from(runHolds).where(eq(runHolds.runId, runId)).for('update');
      if (h) {
        // placeHold only needs to see that the run id is taken; nothing else reads a foreign hold.
        if (h.accountId !== accountId && !foreignHold)
          throw new RepoError('hold_mismatch', 'hold belongs to another account');
        hold = toHold(h);
      }
    }
    let global: Slice['global'];
    if (useGlobal) {
      await t.insert(freeBudgetDays).values({ day, used: 0 }).onConflictDoNothing();
      const [g] = await t
        .select()
        .from(freeBudgetDays)
        .where(eq(freeBudgetDays.day, day))
        .for('update');
      global = { day, used: g?.used ?? 0 };
    }
    return { accountId, account, ...(hold ? { hold } : {}), ...(global ? { global } : {}) };
  }
}

function toHold(h: typeof runHolds.$inferSelect): RunHold {
  return {
    runId: h.runId,
    player: h.accountId,
    status: h.status,
    day: h.day,
    agents: h.agents,
    stepLimit: h.stepLimit,
    hold: h.hold,
    freeHeld: h.freeHeld,
    paidHeld: h.paidHeld,
    entryFee: h.entryFee,
    chargesTurns: h.chargesTurns,
    ticks: [...h.ticks],
    lost: [...h.lost],
    turnsCharged: h.turnsCharged,
    chargedFree: h.chargedFree,
    chargedPaid: h.chargedPaid,
  };
}

function fromHold(h: RunHold) {
  return {
    runId: h.runId,
    status: h.status,
    day: h.day,
    agents: h.agents,
    stepLimit: h.stepLimit,
    hold: h.hold,
    freeHeld: h.freeHeld,
    paidHeld: h.paidHeld,
    entryFee: h.entryFee,
    chargesTurns: h.chargesTurns,
    ticks: h.ticks,
    lost: h.lost,
    turnsCharged: h.turnsCharged,
    chargedFree: h.chargedFree,
    chargedPaid: h.chargedPaid,
  };
}

function toRowInsert(r: PureRow, now: number): typeof ledgerRows.$inferInsert {
  return {
    accountId: r.player,
    type: r.type,
    amount: r.amount,
    source: r.source,
    note: r.note ?? null,
    runId: r.runId ?? (r.type === 'spend' ? (r.ref ?? null) : null),
    txHash: r.type === 'topup' ? (r.ref ?? null) : null,
    createdAt: new Date(now),
  };
}
