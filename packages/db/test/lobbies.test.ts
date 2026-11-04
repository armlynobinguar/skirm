// Private lobbies and tournaments: join by code, settings, settling a match (friend rematch,
// bracket advance), seeding by Elo, no-shows, prize pools paid and refunded on the ledger.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { RepoError, accounts, ledgerAccounts, type LobbyRow } from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const SETTINGS = { mapId: 'copper-hollow', difficulty: 'easy', talk: 'any' as const, crewSize: 2 };

/** Plays the lobby's match to an end: `winner` A (host), B (guest), draw, or a void with a fault. */
async function play(ctx: Ctx, lobby: LobbyRow, end: { winner: 'A' | 'B' | 'draw' } | { fault: 'A' | 'B' | null }) {
  const m = await ctx.repos.v2Matches.create({ mapId: lobby.mapId, ranked: false, teamA: lobby.hostId, teamB: lobby.guestId!, difficulty: lobby.difficulty });
  expect(await ctx.repos.lobbies.begin(lobby.id, m.id)).toBe(true);
  if ('winner' in end)
    await ctx.repos.v2Matches.finish(m.id, { winner: end.winner, reason: 'time', decidedBy: 'score', score: { A: 1, B: end.winner === 'draw' ? 1 : 0 }, ticks: 150 });
  else await ctx.repos.v2Matches.finish(m.id, { winner: null, reason: end.fault ? 'declined' : 'error', fault: end.fault });
  return { matchId: m.id, after: await ctx.repos.lobbies.settleMatch(m.id) };
}

async function fund(ctx: Ctx, accountId: string, credits: number) {
  await ctx.db.update(ledgerAccounts).set({ balance: credits }).where(eq(ledgerAccounts.accountId, accountId));
}

describe('friend lobbies', () => {
  it('joins by code once, refuses your own and a full lobby, and edits only while nobody readied', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cy = await signUp(ctx, 'cy');
    const lobby = await ctx.repos.lobbies.create(ana.id, SETTINGS);
    expect(lobby.code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(ctx.repos.lobbies.join(lobby.code, ana.id)).rejects.toMatchObject({ code: 'own_lobby' });
    expect((await ctx.repos.lobbies.join(lobby.code, ben.id)).guestId).toBe(ben.id);
    expect((await ctx.repos.lobbies.join(lobby.code, ben.id)).guestId).toBe(ben.id);
    await expect(ctx.repos.lobbies.join(lobby.code, cy.id)).rejects.toMatchObject({ code: 'lobby_full' });
    await expect(ctx.repos.lobbies.join('ZZZZZZ', cy.id)).rejects.toBeInstanceOf(RepoError);

    await expect(ctx.repos.lobbies.update(lobby.id, ben.id, { crewSize: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await ctx.repos.lobbies.update(lobby.id, ana.id, { talk: 'open' })).talk).toBe('open');
    await ctx.repos.lobbies.setReady(lobby.id, ben.id, true);
    const view = await ctx.repos.lobbies.view((await ctx.repos.lobbies.get(lobby.id))!);
    expect(view).toMatchObject({ host: { handle: 'ana' }, guest: { handle: 'ben' }, ready: { host: false, guest: true } });
    await expect(ctx.repos.lobbies.update(lobby.id, ana.id, { crewSize: 1 })).rejects.toMatchObject({ code: 'lobby_ready' });

    // The guest leaving frees the seat; the host leaving closes the lobby.
    expect((await ctx.repos.lobbies.leave(lobby.id, ben.id)).guestId).toBeNull();
    expect((await ctx.repos.lobbies.leave(lobby.id, ana.id)).status).toBe('cancelled');
    await expect(ctx.repos.lobbies.join(lobby.code, cy.id)).rejects.toMatchObject({ code: 'lobby_closed' });
  });

  it('opens again for a rematch after each match, unranked: nobody’s Elo moves', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const lobby = await ctx.repos.lobbies.join((await ctx.repos.lobbies.create(ana.id, SETTINGS)).code, ben.id);
    const { matchId, after } = await play(ctx, lobby, { winner: 'B' });
    expect(after).toMatchObject({ status: 'open', winnerId: ben.id, matchId });
    // Settling twice is a no-op.
    expect(await ctx.repos.lobbies.settleMatch(matchId)).toBeNull();
    const [a] = await ctx.db.select({ elo: accounts.elo }).from(accounts).where(eq(accounts.id, ana.id));
    expect(a!.elo).toBe(1200);
    const second = await play(ctx, after!, { fault: null });
    expect(second.after).toMatchObject({ status: 'open', winnerId: null });
    expect(await ctx.repos.lobbies.active(ana.id)).toHaveLength(1);
  });

  it('refuses to begin without a guest, or twice', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const lobby = await ctx.repos.lobbies.create(ana.id, SETTINGS);
    expect(await ctx.repos.lobbies.begin(lobby.id, 'mat_x')).toBe(false);
  });
});

describe('tournaments', () => {
  async function field(ctx: Ctx, n: number) {
    const players = [];
    for (let i = 0; i < n; i++) {
      const p = await signUp(ctx, `p${i}`);
      // p0 has the lowest Elo, p(n-1) the highest.
      await ctx.db.update(accounts).set({ elo: 1000 + i * 10 }).where(eq(accounts.id, p.id));
      players.push(p);
    }
    return players;
  }

  it('spends the pool, seeds by Elo when full, advances winners and pays the top four', async () => {
    const ctx = await setup();
    const [creator] = await field(ctx, 1);
    await fund(ctx, creator!.id, 1000);
    const t = await ctx.repos.tournaments.create({ creatorId: creator!.id, name: 'Cup', size: 4, ...SETTINGS, prizePool: 1000, join: false });
    expect((await ctx.repos.ledger.balance(creator!.id)).balance).toBe(0);
    const players: Awaited<ReturnType<typeof signUp>>[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await signUp(ctx, `q${i}`);
      await ctx.db.update(accounts).set({ elo: 1500 - i * 50 }).where(eq(accounts.id, p.id));
      players.push(p);
    }
    for (const p of players.slice(0, 3)) expect((await ctx.repos.tournaments.join(t.id, p.id)).status).toBe('open');
    expect((await ctx.repos.tournaments.join(t.id, players[3]!.id)).status).toBe('running');
    await expect(ctx.repos.tournaments.join(t.id, creator!.id)).rejects.toMatchObject({ code: 'not_open' });

    let d = (await ctx.repos.tournaments.detail(t.id))!;
    expect(d.entries.map((e) => [e.account.handle, e.seed])).toEqual([
      ['q0', 1],
      ['q1', 2],
      ['q2', 3],
      ['q3', 4],
    ]);
    // 1 v 4 and 2 v 3, the better seed hosting.
    const handle = (id: string | null) => d.entries.find((e) => e.account.id === id)?.account.handle;
    expect(d.matches.map((m) => [m.round, m.slot, handle(m.hostId), handle(m.guestId)])).toEqual([
      [1, 0, 'q0', 'q3'],
      [1, 1, 'q1', 'q2'],
    ]);
    const lobby = async (round: number, slot: number) => (await ctx.repos.lobbies.get(d.matches.find((m) => m.round === round && m.slot === slot)!.lobbyId))!;

    // A bracket match cannot be joined by code or left.
    const semi0 = await lobby(1, 0);
    await expect(ctx.repos.lobbies.join(semi0.code, creator!.id)).rejects.toMatchObject({ code: 'tournament_match' });
    // An upset in semi 0 (the guest wins); a draw in semi 1 goes to the better seed (q1).
    expect((await play(ctx, semi0, { winner: 'B' })).after).toMatchObject({ status: 'done', winnerId: players[3]!.id });
    d = (await ctx.repos.tournaments.detail(t.id))!;
    expect(d.matches).toHaveLength(2);
    // A void nobody caused is played again; then the draw.
    expect((await play(ctx, await lobby(1, 1), { fault: null })).after).toMatchObject({ status: 'open' });
    expect((await play(ctx, await lobby(1, 1), { winner: 'draw' })).after).toMatchObject({ status: 'done', winnerId: players[1]!.id });

    d = (await ctx.repos.tournaments.detail(t.id))!;
    const final = d.matches.find((m) => m.round === 2)!;
    expect([handle(final.hostId), handle(final.guestId)]).toEqual(['q3', 'q1']);
    // The final's guest declines: the host (q3) wins it.
    await play(ctx, await lobby(2, 0), { fault: 'B' });

    d = (await ctx.repos.tournaments.detail(t.id))!;
    expect(d).toMatchObject({ status: 'done', champion: { handle: 'q3' } });
    const byHandle = Object.fromEntries(d.entries.map((e) => [e.account.handle, [e.place, e.prize]]));
    expect(byHandle).toEqual({ q3: [1, 600], q1: [2, 250], q0: [3, 75], q2: [3, 75] });
    expect((await ctx.repos.ledger.balance(players[3]!.id)).balance).toBe(600);
    const rows = await ctx.repos.ledger.rows(players[3]!.id);
    expect(rows[0]).toMatchObject({ type: 'topup', note: 'prize', amount: 600 });
  });

  it('refuses a pool the creator cannot pay, and refunds it when cancelled before the start', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await expect(ctx.repos.tournaments.create({ creatorId: ana.id, name: 'Cup', size: 4, ...SETTINGS, prizePool: 50, join: true })).rejects.toMatchObject({
      code: 'insufficient_credits',
    });
    expect(await ctx.repos.tournaments.list()).toHaveLength(0);
    await fund(ctx, ana.id, 80);
    const t = await ctx.repos.tournaments.create({ creatorId: ana.id, name: 'Cup', size: 4, ...SETTINGS, prizePool: 50, join: true });
    expect((await ctx.repos.ledger.balance(ana.id)).balance).toBe(30);
    expect((await ctx.repos.tournaments.list())[0]).toMatchObject({ entrants: 1, prizePool: 50, status: 'open' });
    const ben = await signUp(ctx, 'ben');
    await expect(ctx.repos.tournaments.cancel(t.id, ben.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await ctx.repos.tournaments.cancel(t.id, ana.id)).status).toBe('cancelled');
    expect((await ctx.repos.tournaments.cancel(t.id, ana.id)).status).toBe('cancelled');
    expect((await ctx.repos.ledger.balance(ana.id)).balance).toBe(80);
  });

  it('decides a no-show: whoever readied goes through, else the better seed', async () => {
    const ctx = await setup();
    const players = await field(ctx, 4);
    const t = await ctx.repos.tournaments.create({ creatorId: players[0]!.id, name: 'Cup', size: 4, ...SETTINGS, prizePool: 0, join: true });
    for (const p of players.slice(1)) await ctx.repos.tournaments.join(t.id, p.id);
    ctx.clock.now += 60 * 60_000;
    const stale = await ctx.repos.lobbies.staleBracket(new Date(ctx.clock.now - 15 * 60_000));
    expect(stale).toHaveLength(2);
    const [a, b] = stale.sort((x, y) => x.slot! - y.slot!);
    // The guest (the worse seed) readied and the host did not.
    await ctx.repos.lobbies.setReady(a!.id, a!.guestId!, true);
    expect((await ctx.repos.lobbies.forfeit(a!.id))!.winnerId).toBe(a!.guestId);
    expect((await ctx.repos.lobbies.forfeit(b!.id))!.winnerId).toBe(b!.hostId);
    expect(await ctx.repos.lobbies.forfeit(b!.id)).toBeNull();
    const d = (await ctx.repos.tournaments.detail(t.id))!;
    expect(d.matches.filter((m) => m.round === 2)).toHaveLength(1);
  });
});
