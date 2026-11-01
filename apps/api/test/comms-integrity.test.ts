// Migration 0010 over HTTP: GET /v2/matches/:id/messages, the practice match view, one player per
// NEAR account and one mint per skill version at a time.
import { NearCallError, skillTokenId, type Minter, type MintResult, type SkillMintInput } from '@skirm/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeOwnership, SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;

beforeAll(async () => {
  h = await setup({ nearOwnership: true });
  ana = await h.as('ciana');
  ben = await h.as('ciben');
});
afterAll(() => h.close());

const crews = {
  A: [{ id: 'agt_1', name: 'Wick', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }],
  B: [{ id: 'agt_2', name: 'Wren', role: 'Scout', vision: 4, comms: 2, tier: 'standard' }],
};

describe('GET /v2/matches/:id/messages', () => {
  it('404 for an unknown match, 409 while live, the delivered lines once it ends', async () => {
    expect((await h.http().get('/v2/matches/mat_01JB7Z3K9QX4M2T8V6N5R1C0DF/messages')).status).toBe(404);
    expect((await h.http().get('/v2/matches/nope/messages')).status).toBe(404);

    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId, crews });
    const live = await ana.get(`/v2/matches/${m.id}/messages`);
    expect(live.status).toBe(409);
    expect(live.body.error.code).toBe('match_live');

    await h.repos.v2Matches.finish(m.id, {
      winner: 'A',
      reason: 'goal',
      messages: [
        { tick: 2, team: 'A', agentId: 'agt_1', agentName: 'Wick', channel: 'say', text: 'east gate', heardBy: ['agt_2'], overheardBy: [] },
        { tick: 2, team: 'B', agentId: 'agt_2', agentName: 'Wren', channel: 'team', text: 'heard that', heardBy: [], overheardBy: ['agt_1'] },
        { tick: 5, team: 'A', agentId: 'agt_1', agentName: 'Wick', channel: 'say', text: 'done', heardBy: [], overheardBy: [] },
      ],
    });
    const res = await h.http().get(`/v2/matches/${m.id}/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      messages: [
        { tick: 2, team: 'A', agent: { id: 'agt_1', name: 'Wick' }, channel: 'say', text: 'east gate', heardBy: ['agt_2'], overheardBy: [] },
        { tick: 2, team: 'B', agent: { id: 'agt_2', name: 'Wren' }, channel: 'team', text: 'heard that', heardBy: [], overheardBy: ['agt_1'] },
        { tick: 5, team: 'A', agent: { id: 'agt_1', name: 'Wick' }, channel: 'say', text: 'done', heardBy: [], overheardBy: [] },
      ],
    });

    const page = await h.http().get(`/v2/matches/${m.id}/messages?limit=2`);
    expect(page.body.messages).toHaveLength(2);
    expect(page.body.next).toBe(2);
    const rest = await h.http().get(`/v2/matches/${m.id}/messages?afterTick=${page.body.next}&limit=2`);
    expect(rest.body).toEqual({ messages: [expect.objectContaining({ tick: 5, text: 'done' })] });

    expect((await h.http().get(`/v2/matches/${m.id}/messages?limit=501`)).status).toBe(400);
    expect((await h.http().get(`/v2/matches/${m.id}/messages?afterTick=-1`)).status).toBe(400);
  });

  it('a match finished without messages has none (no fallback to the log)', async () => {
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    await h.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'time', log: { ticks: [{ says: [{ text: 'refused' }] }] } });
    expect((await h.http().get(`/v2/matches/${m.id}/messages`)).body).toEqual({ messages: [] });
  });
});

describe('practice matches', () => {
  it('GET /v2/matches/:id shows practice and names team B the Greedy bot', async () => {
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice: true, teamA: ana.accountId, teamB: ben.accountId, crews });
    await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal' });
    const res = await h.http().get(`/v2/matches/${m.id}`);
    expect(res.body).toMatchObject({ practice: true, teams: { A: { handle: 'ciana' }, B: { handle: 'Greedy bot' } } });

    const plain = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId, crews });
    await h.repos.v2Matches.finish(plain.id, { winner: 'A', reason: 'goal' });
    expect((await h.http().get(`/v2/matches/${plain.id}`)).body).toMatchObject({ practice: false, teams: { B: { handle: 'ciben' } } });
  });
});

describe('NEAR account links', () => {
  it('a link that loses the race to the unique index is 409 near_account_taken', async () => {
    const link = (handle: string, near: string) => h.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: near });
    expect((await link('ciana', 'race.testnet')).status).toBe(200);
    // Ben's pre-check ran before Ana's link landed.
    vi.spyOn(h.repos.accounts, 'byNearAccount').mockResolvedValueOnce(undefined);
    const lost = await link('ciben', 'race.testnet');
    expect(lost.status).toBe(409);
    expect(lost.body.error.code).toBe('near_account_taken');
    expect((await ben.get('/me')).body.account.nearAccountId).toBeNull();
  });
});

describe('POST /skills/:id/mint', () => {
  const realMinter = () => h.deps.near.minter;
  let saved: Minter;
  beforeAll(() => {
    saved = realMinter();
  });
  afterEach(() => {
    h.deps.near.minter = saved;
    vi.restoreAllMocks();
  });

  /** A new player with a draft skill. */
  async function readyToMint(handle: string, near?: string) {
    const u = await h.as(handle);
    if (near) await h.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: near });
    const skillId = (await u.post('/skills', SAMPLE_SKILL)).body.id as string;
    return { u, skillId };
  }

  it('two concurrent mints make one chain call', async () => {
    const { u, skillId } = await readyToMint('cimint');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: SkillMintInput[] = [];
    h.deps.near.minter = {
      kind: 'noop',
      async mint(s): Promise<MintResult> {
        calls.push(s);
        await gate;
        return { tokenId: skillTokenId(s.id, s.version), status: 'pending' };
      },
    };
    const p1 = u.post(`/skills/${skillId}/mint`).then((r) => r);
    const p2 = u.post(`/skills/${skillId}/mint`).then((r) => r);
    // The one that did not get the claim answers while the other is still on chain.
    const loser = await Promise.race([p1, p2]);
    expect(loser.status).toBe(409);
    expect(loser.body.error.code).toBe('mint_in_progress');
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const winner = r1 === loser ? r2 : r1;
    expect(winner.status).toBe(200);
    expect(winner.body).toEqual({ tokenId: `${skillId}:1`, status: 'pending', benchmark: { status: 'queued' } });
    expect(calls).toHaveLength(1);
    // Afterwards the version is minted and a repeat returns it without another call.
    expect((await u.post(`/skills/${skillId}/mint`)).body).toEqual({ tokenId: `${skillId}:1`, status: 'minted', benchmark: { status: 'queued' } });
    expect(calls).toHaveLength(1);
  });

  it('a failed chain call is recorded as minted when the token exists onchain', async () => {
    const { u, skillId } = await readyToMint('cilost', 'cilost.testnet');
    h.deps.near.minter = {
      kind: 'near',
      async mint(): Promise<MintResult> {
        throw new NearCallError('timeout waiting for the receipt', 'tx_lost');
      },
    };
    (h.ownership as FakeOwnership).owners.set(`${skillId}:1`, 'cilost.testnet');
    const res = await u.post(`/skills/${skillId}/mint`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tokenId: `${skillId}:1`, status: 'minted', txHash: 'tx_lost', benchmark: { status: 'queued' } });
    expect((await u.get(`/skills/${skillId}`)).body).toMatchObject({ status: 'Minted', tokenId: `${skillId}:1` });
  });

  it('a failed chain call with no token is 502 and frees the version for a retry', async () => {
    const { u, skillId } = await readyToMint('cifail', 'cifail.testnet');
    let calls = 0;
    h.deps.near.minter = {
      kind: 'near',
      async mint(): Promise<MintResult> {
        calls++;
        throw new NearCallError('rpc down');
      },
    };
    const res = await u.post(`/skills/${skillId}/mint`);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('mint_failed');
    // Not stuck in "in progress": the retry reaches the chain again.
    expect((await u.post(`/skills/${skillId}/mint`)).status).toBe(502);
    expect(calls).toBe(2);
    expect((await u.get(`/skills/${skillId}`)).body.status).toBe('Draft');
  });
});
