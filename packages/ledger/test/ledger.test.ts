import { describe, expect, it } from 'vitest';
import { DEFAULTS, v2GlobalFreeBudget, type ActionReason } from '@skirm/shared';
import {
  CreditsLedger,
  DEFAULT_LEDGER_CONFIG,
  balancesFromRows,
  emptyLedger,
  placeHold,
  topUp,
  utcDay,
  type LedgerRow,
  type TurnOutcome,
} from '../src/index';

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0); // 5 Nov 2026 12:00 UTC

function makeLedger(config: Partial<typeof DEFAULT_LEDGER_CONFIG> = {}) {
  let now = T0;
  const ledger = new CreditsLedger({ clock: () => now, config });
  return {
    ledger,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (t: number) => {
      now = t;
    },
  };
}

/** One tick of turns for agents 0..n-1, all with the same reason. */
const tick = (n: number, reason: ActionReason = null): TurnOutcome[] =>
  Array.from({ length: n }, (_, agent) => ({ agent, reason }));

function strip(rows: readonly LedgerRow[]) {
  return rows.map(({ type, amount, source, note }) => ({
    type,
    amount,
    source,
    ...(note ? { note } : {}),
  }));
}

function sumBy(rows: readonly LedgerRow[], pred: (r: LedgerRow) => boolean) {
  return rows.filter(pred).reduce((a, r) => a + r.amount, 0);
}

/** Σ hold + Σ free = Σ charge + Σ refund for a closed run. */
function expectRunBalanced(rows: readonly LedgerRow[], runId: string) {
  const mine = rows.filter((r) => r.runId === runId);
  const into = sumBy(mine, (r) => r.type === 'hold' || r.type === 'free');
  const out = sumBy(mine, (r) => r.type === 'charge' || r.type === 'refund');
  expect(out).toBe(into);
}

describe('defaults', () => {
  it('60 free credits a day and G on the v2 talk cost basis', () => {
    expect(DEFAULT_LEDGER_CONFIG.freeAllowance).toBe(60);
    expect(DEFAULT_LEDGER_CONFIG.freeAllowance).toBe(DEFAULTS.free.dailyCredits);
    expect(DEFAULT_LEDGER_CONFIG.globalFreeBudget).toBe(v2GlobalFreeBudget());
    expect(DEFAULT_LEDGER_CONFIG.globalFreeBudget).toBe(4126);
    expect(DEFAULT_LEDGER_CONFIG.maxAgents).toBe(3);
  });
  it('day keys are UTC', () => {
    expect(utcDay(Date.UTC(2026, 10, 5, 23, 59, 59))).toBe('2026-11-05');
    expect(utcDay(Date.UTC(2026, 10, 6, 0, 0, 0))).toBe('2026-11-06');
  });
});

describe('top-up', () => {
  it('adds paid credits and writes a topup row', () => {
    const { ledger } = makeLedger();
    const r = ledger.topUp({ player: 'ana', credits: 1000, ref: 'tx1' });
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([
      {
        seq: 1,
        at: new Date(T0).toISOString(),
        player: 'ana',
        type: 'topup',
        amount: 1000,
        source: 'paid',
        ref: 'tx1',
      },
    ]);
    expect(ledger.balance('ana')).toEqual({ paid: 1000, freeLeft: 60, held: 0, available: 1060 });
  });

  it('credits a receipt once', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 1000, ref: 'tx1' });
    const r = ledger.topUp({ player: 'ana', credits: 1000, ref: 'tx1' });
    expect(r).toMatchObject({ ok: false, error: 'duplicate_topup' });
    expect(ledger.balance('ana').paid).toBe(1000);
    expect(ledger.journal).toHaveLength(1);
  });

  it('refuses zero, negative and fractional amounts', () => {
    const { ledger } = makeLedger();
    for (const credits of [0, -5, 1.5, Number.NaN]) {
      expect(ledger.topUp({ player: 'ana', credits })).toMatchObject({
        ok: false,
        error: 'invalid_amount',
      });
    }
  });

  it('pure functions leave the input state untouched', () => {
    const s0 = emptyLedger();
    const r = topUp(s0, { player: 'ana', credits: 10 }, T0);
    expect(s0).toEqual(emptyLedger());
    expect(r.state.players.ana!.paid).toBe(10);
  });
});

describe('place hold', () => {
  it('draws on the free allowance before the paid balance', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 500 });
    // L = 60, 2 agents: H = 150 = 60 free + 90 paid.
    const r = ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 2 });
    expect(r.ok).toBe(true);
    expect(strip(r.rows)).toEqual([
      { type: 'free', amount: 60, source: 'free' },
      { type: 'hold', amount: 90, source: 'paid' },
    ]);
    expect(ledger.balance('ana')).toEqual({ paid: 410, freeLeft: 0, held: 150, available: 410 });
    expect(ledger.freeBudgetLeft()).toBe(DEFAULT_LEDGER_CONFIG.globalFreeBudget - 60);
  });

  it('holds L × S(n): 60 / 150 / 270 at L = 60', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 10_000 });
    for (const [agents, H] of [
      [1, 60],
      [2, 150],
      [3, 270],
    ] as const) {
      const r = ledger.placeHold({
        player: 'ana',
        runId: `r${agents}`,
        stepLimit: 60,
        agents,
        useAllowance: false,
      });
      expect(sumBy(r.rows, () => true)).toBe(H);
    }
  });

  it('rejects when balance + allowance < H and charges nothing', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 100 });
    // L = 70, 2 agents: H = 175 > 60 + 100.
    const before = ledger.state;
    const r = ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 70, agents: 2 });
    expect(r).toMatchObject({ ok: false, error: 'insufficient_credits', rows: [] });
    expect(ledger.state).toBe(before);
    expect(ledger.balance('ana')).toEqual({ paid: 100, freeLeft: 60, held: 0, available: 160 });
    expect(ledger.journal).toHaveLength(1);
    // Exactly enough passes: L = 50, 2 agents, H = 125 ≤ 160.
    expect(ledger.placeHold({ player: 'ana', runId: 'r2', stepLimit: 50, agents: 2 }).ok).toBe(
      true,
    );
  });

  it('a free player with no balance can hold one 60-step hold, not two', () => {
    const { ledger } = makeLedger();
    expect(ledger.placeHold({ player: 'bo', runId: 'r1', stepLimit: 60, agents: 1 }).ok).toBe(true);
    expect(ledger.placeHold({ player: 'bo', runId: 'r2', stepLimit: 60, agents: 1 })).toMatchObject(
      {
        ok: false,
        error: 'insufficient_credits',
      },
    );
  });

  it('refuses free runs when the global daily budget is empty', () => {
    const { ledger } = makeLedger({ globalFreeBudget: 100 });
    expect(ledger.placeHold({ player: 'a', runId: 'r1', stepLimit: 60, agents: 1 }).ok).toBe(true);
    const r = ledger.placeHold({ player: 'b', runId: 'r2', stepLimit: 60, agents: 1 });
    expect(r).toMatchObject({ ok: false, error: 'free_budget_exhausted' });
    expect(ledger.freeBudgetLeft()).toBe(40);
    expect(ledger.balance('b').available).toBe(40);
  });

  it('validates crew size, step limit, run id', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 10_000 });
    expect(ledger.placeHold({ player: 'ana', runId: 'x', stepLimit: 60, agents: 4 })).toMatchObject(
      { error: 'invalid_crew' },
    );
    expect(ledger.placeHold({ player: 'ana', runId: 'x', stepLimit: 60, agents: 0 })).toMatchObject(
      { error: 'invalid_crew' },
    );
    expect(ledger.placeHold({ player: 'ana', runId: 'x', stepLimit: 0, agents: 1 })).toMatchObject({
      error: 'invalid_amount',
    });
    expect(ledger.placeHold({ player: 'ana', runId: 'x', stepLimit: 60, agents: 1 }).ok).toBe(true);
    expect(ledger.placeHold({ player: 'ana', runId: 'x', stepLimit: 60, agents: 1 })).toMatchObject(
      { error: 'duplicate_run' },
    );
  });
});

describe('per-turn charge', () => {
  it('charges weighted turns as ceil(Σ m_k·t_k), rows summing to Q', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 1000 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 2, useAllowance: false });
    // Tick 1: 1 + 1.5 = 2.5 → 3 charged.
    expect(strip(ledger.chargeTurns('r1', tick(2)).rows)).toEqual([
      { type: 'charge', amount: 3, source: 'paid' },
    ]);
    // Tick 2: 5 → 2 more.
    expect(sumBy(ledger.chargeTurns('r1', tick(2)).rows, () => true)).toBe(2);
    for (let t = 3; t <= 23; t++) ledger.chargeTurns('r1', tick(2));
    expect(ledger.run('r1')).toEqual({ charged: 58, refunded: 0, turnsCharged: 46 });
  });

  it('timeouts, illegal, stale and blocked turns are charged; errors are free', () => {
    const { ledger } = makeLedger();
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 1 });
    for (const reason of ['timeout', 'illegal', 'stale', 'blocked', null] as const) {
      expect(sumBy(ledger.chargeTurns('r1', [{ agent: 0, reason }]).rows, () => true)).toBe(1);
    }
    const r = ledger.chargeTurns('r1', [{ agent: 0, reason: 'error' }]);
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
    expect(ledger.run('r1')).toMatchObject({ charged: 5, turnsCharged: 5 });
  });

  it('a lost agent stops charging; the others keep their weights', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 1000 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 70, agents: 2, useAllowance: false });
    for (let t = 1; t <= 10; t++) ledger.chargeTurns('r1', tick(2));
    ledger.chargeTurns('r1', [
      { agent: 0, reason: null },
      { agent: 1, reason: 'lost' },
    ]);
    for (let t = 12; t <= 32; t++) {
      ledger.chargeTurns('r1', [
        { agent: 0, reason: null },
        { agent: 1, reason: 'lost' },
      ]);
    }
    // 32 × 1 + 10 × 1.5 = 47.
    expect(ledger.run('r1')).toMatchObject({ charged: 47, turnsCharged: 42 });
    expect(ledger.chargeTurns('r1', [{ agent: 1, reason: null }])).toMatchObject({
      ok: false,
      error: 'agent_lost',
    });
  });

  it('is all-or-nothing and never exceeds the hold', () => {
    const { ledger } = makeLedger();
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 2, agents: 1 });
    ledger.chargeTurns('r1', tick(1));
    ledger.chargeTurns('r1', tick(1));
    const before = ledger.state;
    expect(ledger.chargeTurns('r1', tick(1))).toMatchObject({ ok: false, error: 'hold_exceeded' });
    expect(
      ledger.chargeTurns('r1', [
        { agent: 0, reason: null },
        { agent: 5, reason: null },
      ]),
    ).toMatchObject({
      ok: false,
      error: 'invalid_agent',
    });
    expect(ledger.state).toBe(before);
    expect(ledger.chargeTurns('nope', tick(1))).toMatchObject({ ok: false, error: 'unknown_run' });
  });

  it('spends the free part of the hold before the paid part', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 500 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 2 }); // 60 free + 90 paid
    for (let t = 1; t <= 23; t++) ledger.chargeTurns('r1', tick(2));
    const charges = ledger.journal.filter((r) => r.type === 'charge');
    expect(sumBy(charges, (r) => r.source === 'free')).toBe(58);
    expect(sumBy(charges, (r) => r.source === 'paid')).toBe(0);
    for (let t = 24; t <= 26; t++) ledger.chargeTurns('r1', tick(2));
    // 26 × 2.5 = 65: 60 free + 5 paid.
    const all = ledger.journal.filter((r) => r.type === 'charge');
    expect(sumBy(all, (r) => r.source === 'free')).toBe(60);
    expect(sumBy(all, (r) => r.source === 'paid')).toBe(5);
  });
});

describe('settle', () => {
  it('a one-agent hold of 60 from the allowance: 27 charged, 33 returned', () => {
    const { ledger } = makeLedger();
    const hold = ledger.placeHold({ player: 'ana', runId: 'fg', stepLimit: 60, agents: 1 });
    expect(strip(hold.rows)).toEqual([{ type: 'free', amount: 60, source: 'free' }]);
    expect(ledger.balance('ana')).toMatchObject({ paid: 0, freeLeft: 0, held: 60 });

    for (let t = 1; t <= 27; t++) {
      const r = ledger.chargeTurns('fg', tick(1));
      expect(strip(r.rows)).toEqual([{ type: 'charge', amount: 1, source: 'free' }]);
    }
    const s = ledger.settle('fg');
    expect(s.ok).toBe(true);
    expect(strip(s.rows)).toEqual([{ type: 'refund', amount: 33, source: 'free' }]);
    expect(ledger.run('fg')).toEqual({ charged: 27, refunded: 33, turnsCharged: 27 });
    expect(ledger.balance('ana')).toEqual({ paid: 0, freeLeft: 33, held: 0, available: 33 });
    expect(ledger.freeBudgetLeft()).toBe(DEFAULT_LEDGER_CONFIG.globalFreeBudget - 27);
    expect(strip(ledger.journal).map((r) => r.type)).toEqual([
      'free',
      ...Array(27).fill('charge'),
      'refund',
    ]);
    expectRunBalanced(ledger.journal, 'fg');
  });

  it('Formulas §2 table: refunds 33 / 92 / 21 / 52 / 13 / 95', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 10_000 });
    const rows = [
      [60, 1, 27, 60, 27, 33],
      [60, 2, 23, 150, 58, 92],
      [50, 1, 29, 50, 29, 21],
      [50, 2, 29, 125, 73, 52],
      [70, 1, 57, 70, 57, 13],
      [70, 2, 32, 175, 80, 95],
    ] as const;
    rows.forEach(([L, n, ticks, H, Q, refund], i) => {
      const runId = `run${i}`;
      const h = ledger.placeHold({
        player: 'ana',
        runId,
        stepLimit: L,
        agents: n,
        useAllowance: false,
      });
      expect(sumBy(h.rows, () => true)).toBe(H);
      for (let t = 0; t < ticks; t++) ledger.chargeTurns(runId, tick(n));
      const s = ledger.settle(runId);
      expect(sumBy(s.rows, () => true)).toBe(refund);
      expect(ledger.run(runId)).toMatchObject({ charged: Q, refunded: refund });
      expectRunBalanced(ledger.journal, runId);
    });
    expect(ledger.balance('ana').paid).toBe(10_000 - (27 + 58 + 29 + 73 + 57 + 80));
  });

  it('a failed run settles the same way; a settled run cannot be charged or settled again', () => {
    const { ledger } = makeLedger();
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 1 });
    for (let t = 0; t < 60; t++) ledger.chargeTurns('r1', tick(1));
    expect(ledger.settle('r1').rows).toEqual([]); // the whole hold was used
    expect(ledger.run('r1')).toEqual({ charged: 60, refunded: 0, turnsCharged: 60 });
    expect(ledger.settle('r1')).toMatchObject({ ok: false, error: 'run_closed' });
    expect(ledger.chargeTurns('r1', tick(1))).toMatchObject({ ok: false, error: 'run_closed' });
    expect(ledger.abort('r1')).toMatchObject({ ok: false, error: 'run_closed' });
  });
});

describe('abort', () => {
  it('refunds the full hold and the entry fee, reversing charges', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 1000 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 2, entryFee: 250 });
    for (let t = 0; t < 5; t++) ledger.chargeTurns('r1', tick(2));
    const r = ledger.abort('r1');
    expect(r.ok).toBe(true);
    expectRunBalanced(ledger.journal, 'r1');
    expect(ledger.balance('ana')).toEqual({ paid: 1000, freeLeft: 60, held: 0, available: 1060 });
    expect(ledger.run('r1')).toEqual({ charged: 0, refunded: 400, turnsCharged: 10 });
    expect(ledger.freeBudgetLeft()).toBe(DEFAULT_LEDGER_CONFIG.globalFreeBudget);
  });

  it('reverses per-turn charges on a normal run', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 200 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 2 });
    for (let t = 0; t < 30; t++) ledger.chargeTurns('r1', tick(2)); // 75: 60 free + 15 paid
    const r = ledger.abort('r1');
    expect(strip(r.rows)).toEqual([
      { type: 'charge', amount: -60, source: 'free', note: 'reversal' },
      { type: 'charge', amount: -15, source: 'paid', note: 'reversal' },
      { type: 'refund', amount: 60, source: 'free' },
      { type: 'refund', amount: 90, source: 'paid' },
    ]);
    expect(ledger.balance('ana')).toEqual({ paid: 200, freeLeft: 60, held: 0, available: 260 });
  });
});

describe('entry fee', () => {
  it('is held with the run, moved to the pool at once, and kept on a fail', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 300 });
    const h = ledger.placeHold({
      player: 'ana',
      runId: 'p1',
      stepLimit: 60,
      agents: 1,
      entryFee: 100,
    });
    expect(strip(h.rows)).toEqual([
      { type: 'free', amount: 60, source: 'free' },
      { type: 'hold', amount: 100, source: 'paid' },
      { type: 'charge', amount: 100, source: 'paid', note: 'entry_fee' },
    ]);
    expect(ledger.balance('ana')).toMatchObject({ paid: 200, held: 60 });
    // Formulas §5 (proposed): the fee includes the run, so turns are not charged.
    for (let t = 0; t < 60; t++) expect(ledger.chargeTurns('p1', tick(1)).rows).toEqual([]);
    const s = ledger.settle('p1');
    expect(strip(s.rows)).toEqual([{ type: 'refund', amount: 60, source: 'free' }]);
    expect(ledger.balance('ana')).toEqual({ paid: 200, freeLeft: 60, held: 0, available: 260 });
    expect(ledger.run('p1')).toMatchObject({ charged: 0, turnsCharged: 60 });
    expectRunBalanced(ledger.journal, 'p1');
  });

  it('comes from the paid balance only: hold rejected if paid cannot cover the fee', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 99 });
    expect(
      ledger.placeHold({ player: 'ana', runId: 'p1', stepLimit: 60, agents: 1, entryFee: 100 }),
    ).toMatchObject({
      ok: false,
      error: 'insufficient_credits',
    });
  });
});

describe('daily reset at 00:00 UTC', () => {
  it('renews the allowance and the global budget', () => {
    const { ledger, setNow } = makeLedger({ globalFreeBudget: 1000 });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 1 });
    for (let t = 0; t < 60; t++) ledger.chargeTurns('r1', tick(1));
    ledger.settle('r1');
    expect(ledger.balance('ana').freeLeft).toBe(0);
    expect(ledger.freeBudgetLeft()).toBe(940);
    setNow(Date.UTC(2026, 10, 5, 23, 59, 59, 999));
    expect(ledger.balance('ana').freeLeft).toBe(0);
    setNow(Date.UTC(2026, 10, 6, 0, 0, 0));
    expect(ledger.balance('ana').freeLeft).toBe(60);
    expect(ledger.freeBudgetLeft()).toBe(1000);
  });

  it('a run held before midnight and settled after does not top up the new allowance', () => {
    const { ledger, setNow } = makeLedger({ globalFreeBudget: 1000 });
    setNow(Date.UTC(2026, 10, 5, 23, 59, 0));
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 60, agents: 1 });
    for (let t = 0; t < 27; t++) ledger.chargeTurns('r1', tick(1));
    setNow(Date.UTC(2026, 10, 6, 0, 1, 0));
    const s = ledger.settle('r1');
    expect(strip(s.rows)).toEqual([
      { type: 'refund', amount: 33, source: 'free', note: 'expired' },
    ]);
    expect(ledger.balance('ana').freeLeft).toBe(60);
    expect(ledger.freeBudgetLeft()).toBe(1000);
    expectRunBalanced(ledger.journal, 'r1');
  });
});

describe('spend', () => {
  it('debits paid credits only: the allowance and the global budget are untouched', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 100, ref: 'a' });
    const budget = ledger.freeBudgetLeft();
    const r = ledger.spend({ player: 'ana', amount: 60, ref: 'cosmetic:outfit_obsidian' });
    expect(r.ok).toBe(true);
    expect(strip(r.rows)).toEqual([
      { type: 'spend', amount: 60, source: 'paid', note: 'cosmetic' },
    ]);
    expect(r.rows[0]!.ref).toBe('cosmetic:outfit_obsidian');
    expect(ledger.balance('ana')).toMatchObject({ paid: 40, freeLeft: 60, held: 0 });
    expect(ledger.freeBudgetLeft()).toBe(budget);
  });

  it('refuses when paid credits are short, even with the allowance unused', () => {
    const { ledger } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 30, ref: 'a' });
    const r = ledger.spend({ player: 'ana', amount: 40, ref: 'cosmetic:hair_platinum' });
    expect(r).toMatchObject({
      ok: false,
      error: 'insufficient_credits',
      need: 40,
      have: 30,
      rows: [],
    });
    expect(ledger.balance('ana')).toMatchObject({ paid: 30, freeLeft: 60 });
    expect(ledger.spend({ player: 'bo', amount: 1, ref: 'x' })).toMatchObject({
      ok: false,
      need: 1,
      have: 0,
    });
    for (const amount of [0, -5, 1.5])
      expect(ledger.spend({ player: 'ana', amount, ref: 'x' })).toMatchObject({
        ok: false,
        error: 'invalid_amount',
      });
  });
});

describe('journal', () => {
  it('rows alone rebuild every balance', () => {
    const { ledger, advance } = makeLedger();
    ledger.topUp({ player: 'ana', credits: 400, ref: 'a' });
    ledger.topUp({ player: 'bo', credits: 50, ref: 'b' });
    ledger.placeHold({ player: 'ana', runId: 'r1', stepLimit: 70, agents: 2 });
    ledger.placeHold({ player: 'bo', runId: 'r2', stepLimit: 50, agents: 1 });
    ledger.placeHold({ player: 'ana', runId: 'r3', stepLimit: 60, agents: 1, entryFee: 100 });
    for (let t = 0; t < 32; t++) ledger.chargeTurns('r1', tick(2));
    for (let t = 0; t < 29; t++) ledger.chargeTurns('r2', tick(1));
    advance(60_000);
    ledger.settle('r1');
    ledger.settle('r2');
    ledger.abort('r3');
    expect(ledger.spend({ player: 'ana', amount: 80, ref: 'cosmetic:outfit_neon' }).ok).toBe(true);

    const day = utcDay(T0);
    const rebuilt = balancesFromRows(ledger.journal, day);
    for (const player of ['ana', 'bo']) {
      const b = ledger.balance(player);
      expect(rebuilt[player]!.paid).toBe(b.paid);
      expect(60 - rebuilt[player]!.freeUsed).toBe(b.freeLeft);
    }
    expect(ledger.journal.map((r) => r.seq)).toEqual(ledger.journal.map((_, i) => i + 1));
    for (const id of ['r1', 'r2', 'r3']) expectRunBalanced(ledger.journal, id);
  });

  it('the pure API threads state explicitly', () => {
    let s = emptyLedger();
    s = topUp(s, { player: 'ana', credits: 100 }, T0).state;
    const r = placeHold(s, { player: 'ana', runId: 'r', stepLimit: 70, agents: 2 }, T0);
    expect(r).toMatchObject({ ok: false, error: 'insufficient_credits' });
    expect(r.state).toBe(s);
  });
});
