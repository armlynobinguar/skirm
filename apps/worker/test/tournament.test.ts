// Tournament consumer: the tick settles lobbies whose match ended without realtime settling them,
// and decides bracket matches nobody started within TOURNAMENT.noShowMs.
import { TOURNAMENT } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { processTournamentTick } from '../src/tournament-processor';
import { setup } from './helpers';

const T0 = Date.UTC(2026, 10, 4, 12);

async function ctxAt() {
  let now = T0;
  const clock = { now: () => now, sleep: async () => undefined };
  const c = await setup({ clock }, { clock: () => now, ledger: { clock: () => now } });
  const signUp = async (handle: string) => (await c.repos.accounts.getOrCreate({ handle }, c.vault)).account;
  return { c, signUp, at: (t: number) => (now = t) };
}

describe('tournament tick', () => {
  it('settles a lobby whose match ended unsettled, once', async () => {
    const { c, signUp } = await ctxAt();
    const ana = await signUp('ana');
    const ben = await signUp('ben');
    const lobby = await c.repos.lobbies.join((await c.repos.lobbies.create(ana.id, { mapId: 'copper-hollow', difficulty: 'easy', talk: 'any', crewSize: 1 })).code, ben.id);
    const m = await c.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id, difficulty: 'easy' });
    await c.repos.lobbies.begin(lobby.id, m.id);
    // Still live: nothing to settle.
    expect((await processTournamentTick(c.deps)).settled).toEqual([]);
    await c.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 3, B: 0 }, ticks: 40 });
    expect((await processTournamentTick(c.deps)).settled).toEqual([m.id]);
    expect(await c.repos.lobbies.get(lobby.id)).toMatchObject({ status: 'open', winnerId: ana.id });
    expect((await processTournamentTick(c.deps)).settled).toEqual([]);
  });

  it('decides bracket no-shows after the window, moving the bracket on', async () => {
    const { c, signUp, at } = await ctxAt();
    const players = [await signUp('p1'), await signUp('p2'), await signUp('p3'), await signUp('p4')];
    const t = await c.repos.tournaments.create({ creatorId: players[0]!.id, name: 'Cup', size: 4, mapId: 'copper-hollow', difficulty: 'easy', talk: 'any', crewSize: 1, prizePool: 0, join: true });
    for (const p of players.slice(1)) await c.repos.tournaments.join(t.id, p.id);
    at(T0 + TOURNAMENT.noShowMs - 1000);
    expect((await processTournamentTick(c.deps)).forfeited).toEqual([]);
    at(T0 + TOURNAMENT.noShowMs + 1000);
    expect((await processTournamentTick(c.deps)).forfeited).toHaveLength(2);
    // The final opened just now, so it waits its own window.
    expect((await processTournamentTick(c.deps)).forfeited).toEqual([]);
    at(T0 + 2 * TOURNAMENT.noShowMs + 2000);
    expect((await processTournamentTick(c.deps)).forfeited).toHaveLength(1);
    expect((await c.repos.tournaments.detail(t.id))!.status).toBe('done');
  });
});
