// V2Credits on the Postgres ledger. A crew's match is one ledger hold (`<matchId>-<team>`) of a single
// weight-1 "agent" whose step limit is the crew's whole-match hold in whole credits (every tick at its
// talk rates, rounded up once), so the existing hold rules apply unchanged: the free allowance first,
// then paid credits. The match charges whole credits as its running per-100 cost crosses them (some
// ticks charge 0, which is a no-op), each as a weight-1 turn; settle returns the rest, release all of it.
import type { LedgerRepo } from '@skirm/db';
import type { Team } from '@skirm/engine/v2';
import type { Logger } from '../deps';
import type { V2Credits } from './match';

export const v2HoldId = (matchId: string, team: Team) => `${matchId}-${team}`;

export class LedgerV2Credits implements V2Credits {
  constructor(
    private readonly ledger: Pick<LedgerRepo, 'hold' | 'chargeTurns' | 'settle' | 'abort'>,
    private readonly matchId: string,
    private readonly log: Logger,
  ) {}

  async hold(team: Team, accountId: string, amount: number) {
    const r = await this.ledger.hold({ accountId, runId: v2HoldId(this.matchId, team), stepLimit: amount, agents: 1 });
    if (r.ok) return { ok: true as const };
    this.log.warn(`v2 match ${this.matchId} ${team}: hold refused: ${r.error}`);
    return { ok: false as const, need: r.need ?? amount, have: r.have ?? 0 };
  }

  async charge(team: Team, amount: number) {
    if (amount <= 0) return;
    const r = await this.ledger.chargeTurns(v2HoldId(this.matchId, team), Array.from({ length: amount }, () => ({ agent: 0, reason: null })));
    if (!r.ok) this.log.warn(`v2 match ${this.matchId} ${team}: charge failed: ${r.error}`);
  }

  async settle(team: Team) {
    const r = await this.ledger.settle(v2HoldId(this.matchId, team));
    if (!r.ok) this.log.warn(`v2 match ${this.matchId} ${team}: settle failed: ${r.error}`);
  }

  async release(team: Team) {
    const r = await this.ledger.abort(v2HoldId(this.matchId, team));
    if (!r.ok) this.log.warn(`v2 match ${this.matchId} ${team}: release failed: ${r.error}`);
  }
}
