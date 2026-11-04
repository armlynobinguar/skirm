// Private lobbies and tournaments over the api: make, join by code, settings, leave; tournaments
// with a prize pool in paid credits (402 when short), public bracket, join until full, cancel.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

async function paid(handle: string, credits: number) {
  const u = await h.as(handle);
  const acc = (await h.repos.accounts.byHandle(handle))!;
  await h.repos.ledger.topUp({ accountId: acc.id, credits });
  return { u, acc };
}

describe('lobbies', () => {
  it('makes a lobby, joins it by code, edits it as the host and leaves it', async () => {
    const ana = await h.as('lana');
    const ben = await h.as('lben');
    const made = await ana.post('/lobbies', { mapId: 'copper-hollow', difficulty: 'easy', talk: 'standard', crewSize: 3 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ host: { handle: 'lana' }, guest: null, status: 'open', talk: 'standard', ready: { host: false, guest: false } });
    expect(made.body.code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await ana.post('/lobbies', { mapId: 'nowhere' })).status).toBe(400);
    expect((await ana.post('/lobbies', { mapId: 'copper-hollow', talk: 'loud' })).status).toBe(400);

    const preview = await ben.get(`/lobbies/code/${made.body.code.toLowerCase()}`);
    expect(preview.body).toMatchObject({ id: made.body.id, host: { handle: 'lana' } });
    expect((await ben.get(`/lobbies/${made.body.id}`)).status).toBe(404);
    expect((await ana.post('/lobbies/join', { code: made.body.code })).body.error.code).toBe('own_lobby');
    const joined = await ben.post('/lobbies/join', { code: made.body.code });
    expect(joined.status).toBe(200);
    expect(joined.body.guest).toMatchObject({ handle: 'lben' });
    expect((await (await h.as('lcy')).post('/lobbies/join', { code: made.body.code })).body.error.code).toBe('lobby_full');

    expect((await ben.patch(`/lobbies/${made.body.id}`, { crewSize: 1 })).status).toBe(403);
    const edited = await ana.patch(`/lobbies/${made.body.id}`, { crewSize: 2, difficulty: 'hard' });
    expect(edited.body).toMatchObject({ crewSize: 2, difficulty: 'hard' });
    expect(((await ben.get('/lobbies')).body as { id: string }[]).map((l) => l.id)).toContain(made.body.id);

    expect((await ben.del(`/lobbies/${made.body.id}`)).body.guest).toBeNull();
    expect((await ana.del(`/lobbies/${made.body.id}`)).body.status).toBe('cancelled');
    expect((await ben.post('/lobbies/join', { code: made.body.code })).body.error.code).toBe('lobby_closed');
  });
});

describe('tournaments', () => {
  it('spends a prize pool, refuses one the creator cannot pay, and refunds a cancel', async () => {
    const { u, acc } = await paid('tcreator', 500);
    const short = await u.post('/tournaments', { name: 'Big Cup', size: 4, mapId: 'copper-hollow', prizePool: 900 });
    expect(short.status).toBe(402);
    expect(short.body.error).toMatchObject({ code: 'insufficient_credits', need: 900, have: 500 });
    const made = await u.post('/tournaments', { name: 'Small Cup', size: 4, mapId: 'copper-hollow', prizePool: 400 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Small Cup', status: 'open', entrants: 1, prizePool: 400, rounds: 2, you: { joined: true, creator: true } });
    expect((await h.repos.ledger.balance(acc.id)).balance).toBe(100);
    const other = await h.as('tother');
    expect((await other.post(`/tournaments/${made.body.id}/cancel`)).status).toBe(403);
    expect((await u.post(`/tournaments/${made.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await h.repos.ledger.balance(acc.id)).balance).toBe(500);
    const rows = (await u.get('/credits')).body.rows as { type: string; note: string | null; amount: number }[];
    expect(rows.slice(0, 2).map((r) => [r.type, r.note, r.amount])).toEqual([
      ['topup', 'prize_pool', 400],
      ['spend', 'prize_pool', 400],
    ]);
  });

  it('fills, draws the bracket by Elo and shows it publicly with the caller’s match', async () => {
    const host = await h.as('bhost');
    const made = (await host.post('/tournaments', { name: 'Open Cup', size: 4, mapId: 'copper-hollow', talk: 'any', join: false })).body;
    expect(made.you).toMatchObject({ joined: false, creator: true });
    const players = [];
    for (const n of ['b1', 'b2', 'b3', 'b4']) players.push(await h.as(n));
    for (const p of players.slice(0, 3)) expect((await p.post(`/tournaments/${made.id}/join`)).body.status).toBe('open');
    const full = await players[3]!.post(`/tournaments/${made.id}/join`);
    expect(full.body.status).toBe('running');
    expect(full.body.matches).toHaveLength(2);
    expect(full.body.you.lobbyId).toEqual(expect.stringMatching(/^lby_/));
    expect((await host.post(`/tournaments/${made.id}/join`)).body.error.code).toBe('not_open');

    const pub = await h.http().get(`/tournaments/${made.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.you).toBeUndefined();
    expect(pub.body.entries.map((e: { seed: number }) => e.seed).sort()).toEqual([1, 2, 3, 4]);
    const list = await players[0]!.get('/tournaments?status=running');
    expect(list.body.find((t: { id: string }) => t.id === made.id)).toMatchObject({ joined: true, entrants: 4 });
    expect((await h.http().get('/tournaments/trn_nope')).status).toBe(404);
  });
});
