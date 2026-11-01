// Stateful wrapper around the pure ledger with an injectable clock and an append-only journal.
import {
  DEFAULT_LEDGER_CONFIG,
  abort,
  balanceOf,
  chargeTurns,
  emptyLedger,
  freeBudgetLeft,
  placeHold,
  runSummary,
  settle,
  spend,
  topUp,
  type Balance,
  type LedgerConfig,
  type LedgerResult,
  type LedgerRow,
  type LedgerState,
  type PlaceHoldInput,
  type SettleResult,
  type SpendInput,
  type TopUpInput,
  type TurnOutcome,
} from './ledger';

/** Returns the current time in ms since the epoch. */
export type Clock = () => number;

export class CreditsLedger {
  private current: LedgerState;
  private readonly journalRows: LedgerRow[] = [];
  readonly config: LedgerConfig;
  private readonly clock: Clock;

  constructor(opts: { clock?: Clock; config?: Partial<LedgerConfig>; state?: LedgerState } = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...opts.config };
    this.current = opts.state ?? emptyLedger();
  }

  get state(): LedgerState {
    return this.current;
  }

  /** Every row written so far, in seq order. */
  get journal(): readonly LedgerRow[] {
    return this.journalRows;
  }

  private commit(result: LedgerResult): LedgerResult {
    if (result.ok) {
      this.current = result.state;
      this.journalRows.push(...result.rows);
    }
    return result;
  }

  topUp(input: TopUpInput): LedgerResult {
    return this.commit(topUp(this.current, input, this.clock()));
  }

  spend(input: SpendInput): LedgerResult {
    return this.commit(spend(this.current, input, this.clock()));
  }

  placeHold(input: PlaceHoldInput): LedgerResult {
    return this.commit(placeHold(this.current, input, this.clock(), this.config));
  }

  chargeTurns(runId: string, turns: readonly TurnOutcome[]): LedgerResult {
    return this.commit(chargeTurns(this.current, { runId, turns }, this.clock(), this.config));
  }

  settle(runId: string): LedgerResult {
    return this.commit(settle(this.current, { runId }, this.clock()));
  }

  abort(runId: string): LedgerResult {
    return this.commit(abort(this.current, { runId }, this.clock()));
  }

  balance(player: string): Balance {
    return balanceOf(this.current, player, this.clock(), this.config);
  }

  freeBudgetLeft(): number {
    return freeBudgetLeft(this.current, this.clock(), this.config);
  }

  run(runId: string): SettleResult | undefined {
    return runSummary(this.current, runId);
  }
}
