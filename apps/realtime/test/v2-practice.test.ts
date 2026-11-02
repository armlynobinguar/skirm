// Practice against the greedy bot over the hub: the judge path (a fresh account, no model key, the
// greedy brain) plays a whole match on DEFAULT_PRACTICE for free; a model brain pays its own crew's
// rates while the bot never holds; no Elo, no registry job; delivered lines, skill versions and the
// ownership filter land with the result; and the realtime brain reports spend to the CostMonitor.
import { OfficialRepo, STARTER_SKILL, SYSTEM_ACCOUNT_ID, skillOwnership } from '@skirm/db';
import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import { BOT_HANDLE, DEFAULT_PRACTICE, MAPS_V2, botCrew, createMatch, observe } from '@skirm/engine/v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { V2_TICK_MS_MIN, parseV2TickMs } from '../src/timing';
import { createRealtimeV2Brain } from '../src/v2/brain';
import { FakeSocket, delay, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

/** The process env without a model key: what a judge runs with. */
function keylessEnv() {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.V2_BRAIN;
  return env;
}

/** A model brain stand-in: greedy moves, and a team line whenever its tier lets it speak. */
const talkative: V2Brain = {
  kind: 'haiku',
  model: 'fake-haiku',
  async act(o, ctx) {
    const d = await createGreedyBrain().act(o, { ...ctx, canSpeak: false });
    return { ...d, say: ctx.canSpeak ? { channel: 'team', text: 'Going for the crate.' } : null };
  },
  async plan() {
    return { text: null };
  },
};

async function practiceDeps(v2Brain: V2Brain, log?: Logger): Promise<TestDeps> {
  const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain, ...(log ? { log } : {}) });
  await new OfficialRepo(deps.repos.db).ensureSystem();
  return deps;
}

/** A fresh account (no credits bought, today's free allowance) signed in over the hub. */
async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { sock, acc, agents, send, inbox: sock.inbox };
}

type Player = Awaited<ReturnType<typeof player>>;

/** Queues practice with one agent and plays it through as the player; returns the found and end messages. */
async function playPractice(p: Player, agent = 0, extra: Record<string, unknown> = {}) {
  await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[agent]!.id, tier: 'standard' }], ranked: false, opponent: 'bot', ...extra });
  const found = await p.inbox.next('v2_found');
  await p.send({ type: 'v2_accept', matchId: found.matchId });
  const lockin = await p.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
  await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
  const start = await p.inbox.next('v2_start', (m) => m.matchId === found.matchId);
  const end = await p.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
  return { found, lockin, start, end };
}

describe('v2 practice against the greedy bot', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('JUDGE PATH: a fresh account with no model key plays a whole match on the default board for free', async () => {
    const brain = createRealtimeV2Brain(keylessEnv(), { record: async () => undefined }, { info() {}, warn() {}, error() {} });
    expect(brain.kind).toBe('greedy');
    const deps = await practiceDeps(brain);
    hub = new RealtimeHub(deps);
    const judge = await player(hub, deps, 'judge');
    const before = await deps.repos.ledger.balance(judge.acc.id);
    expect(before).toMatchObject({ balance: 0, held: 0, allowanceLeft: 60 });

    const { found, lockin, start, end } = await playPractice(judge);
    expect(found).toMatchObject({ team: 'A', ranked: false, practice: true, free: true, rivalHandle: BOT_HANDLE, mapId: DEFAULT_PRACTICE.mapId, difficulty: DEFAULT_PRACTICE.difficulty });
    expect(lockin).toMatchObject({ free: true, rival: { agents: 1 } });
    expect(start.rival.handle).toBe(BOT_HANDLE);
    expect(end.result).not.toBeNull();
    expect(end.logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(end.debrief).toMatchObject({ eloDelta: null, registry: null, credits: { held: 0, used: 0, returned: 0 } });

    // Not one credit moved, and the bot side never held either.
    const after = await deps.repos.ledger.balance(judge.acc.id);
    expect(after).toMatchObject({ balance: before.balance, held: 0, allowanceLeft: before.allowanceLeft, available: before.available });
    expect(await deps.repos.ledger.balance(SYSTEM_ACCOUNT_ID)).toMatchObject({ held: 0 });

    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row).toMatchObject({ status: 'ended', teamAAccountId: judge.acc.id, teamBAccountId: SYSTEM_ACCOUNT_ID, practice: true, ranked: false, difficulty: DEFAULT_PRACTICE.difficulty, logHash: end.logHash, eloDeltas: [], registryStatus: 'none' });
    expect(row.stats!.A.charged).toBe(0);
    expect(row.stats!.B.charged).toBe(0);
    // Easy: the bot talks Quiet and waits 12 s (practiceRival).
    expect(row.crews!.B.map((a) => a.tier)).toEqual(['quiet']);
    const acc = (await deps.repos.accounts.get(judge.acc.id))!;
    expect(acc).toMatchObject({ elo: judge.acc.elo, rankedMatches: 0, wins: 0, losses: 0, draws: 0 });
    expect(deps.registryJobs).toEqual([]);
    // The bot account is never "playing": the judge can practice again straight away.
    await delay(20);
    expect(hub.v2.isBusy(SYSTEM_ACCOUNT_ID)).toBe(false);
    expect(hub.v2.isBusy(judge.acc.id)).toBe(false);
  });

  it('fields a full Open-talk bot crew against a lone agent on Mega Agentic', async () => {
    const deps = await practiceDeps(createGreedyBrain());
    hub = new RealtimeHub(deps);
    const cam = await player(hub, deps, 'cam');
    const { found, lockin, end } = await playPractice(cam, 0, { mapId: 'copper-hollow', difficulty: 'mega' });
    expect(found).toMatchObject({ practice: true, difficulty: 'mega' });
    expect(lockin).toMatchObject({ rival: { agents: 3 } });
    expect(end.result).not.toBeNull();
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row.crews!.B.map((a) => a.tier)).toEqual(['open', 'open', 'open']);
  });

  it('plays two players’ practice matches at once, each against its own bot', async () => {
    const deps = await practiceDeps(createGreedyBrain());
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const [a, b] = await Promise.all([playPractice(ana, 1), playPractice(ben, 1)]);
    expect(a.found.matchId).not.toBe(b.found.matchId);
    for (const [p, r] of [[ana, a], [ben, b]] as const) {
      expect(r.end.result).not.toBeNull();
      expect(await deps.repos.v2Matches.get(r.found.matchId)).toMatchObject({ status: 'ended', practice: true, teamAAccountId: p.acc.id, teamBAccountId: SYSTEM_ACCOUNT_ID });
    }
  });

  it('holds and charges a player on a model brain at the normal rates, never the bot', async () => {
    const deps = await practiceDeps(talkative);
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const before = await deps.repos.ledger.balance(ana.acc.id);
    const { found, lockin, end } = await playPractice(ana, 1);
    expect(found.practice).toBe(true);
    expect(found.free).toBeUndefined();
    expect(lockin.free).toBeUndefined();
    expect(end.result).not.toBeNull();
    // One Standard agent: 20 hundredths of a credit a tick, held as 30 and charged in whole credits.
    const used = Math.ceil((end.result!.ticks * 20) / 100);
    expect(used).toBeGreaterThan(0);
    expect(end.debrief!.credits).toEqual({ held: 30, used, returned: 30 - used });
    const after = await deps.repos.ledger.balance(ana.acc.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(used);
    expect(used).toBeLessThanOrEqual(30);
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row.stats!.A.charged).toBe(used);
    expect(row.stats!.B.charged).toBe(0);
    expect(row.debriefs!.B!.credits).toEqual({ held: 0, used: 0, returned: 0 });
    expect(await deps.repos.ledger.balance(SYSTEM_ACCOUNT_ID)).toMatchObject({ held: 0 });
    // The log names each crew's brain.
    expect((row.log as { header: { models: { actor: string } } }).header.models.actor).toBe('A:fake-haiku B:greedy');
  });

  it('refuses a ranked practice', async () => {
    const deps = await practiceDeps(createGreedyBrain());
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: true, opponent: 'bot' });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'practice_unranked' });
    await delay(30);
    expect(ana.inbox.ofType('v2_found')).toHaveLength(0);
    expect(hub.v2.isBusy(ana.acc.id)).toBe(false);
  });

  it('refuses a map that does not exist or does not take the crew, and a second match while playing', async () => {
    const deps = await practiceDeps(createGreedyBrain());
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot', mapId: 'nowhere' });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[1]!.id, tier: 'standard' }], ranked: false, opponent: 'bot', mapId: 'frostline-depot', difficulty: 'hard' });
    expect(await ana.inbox.next('v2_found')).toMatchObject({ mapId: 'frostline-depot', difficulty: 'hard', practice: true });
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[2]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'in_match' });
  });

  it('stores the lines the engine delivered with the result', async () => {
    const deps = await practiceDeps(talkative);
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const { found, end } = await playPractice(ana, 1);
    expect(end.result).not.toBeNull();
    const { messages } = await deps.repos.matchMessages.list(found.matchId, { limit: 500 });
    expect(messages.length).toBeGreaterThan(0);
    const mine = messages.filter((m) => m.team === 'A');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.agentId === ana.agents[1]!.id && m.agentName === ana.agents[1]!.name && m.channel === 'team' && m.text === 'Going for the crate.')).toBe(true);
    // Standard speaks at most once every 5 ticks.
    const ticks = mine.map((m) => m.tick);
    expect(ticks.every((t, i) => i === 0 || t - ticks[i - 1]! >= 5)).toBe(true);
    expect(ticks.every((t) => t >= 1 && t <= end.result!.ticks)).toBe(true);
  });

  it('records the skill versions played and never decrypts a skill the player no longer owns', async () => {
    const warns: string[] = [];
    const deps = await practiceDeps(createGreedyBrain(), { info() {}, warn: (m) => warns.push(m), error() {} });
    const decrypt = vi.fn(deps.vault.decryptSkill.bind(deps.vault));
    deps.vault = { encryptSkill: deps.vault.encryptSkill.bind(deps.vault), decryptSkill: decrypt };
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    // Rook (agent 0) runs the starter skill.
    expect(ana.agents[0]!.skills).toEqual([expect.objectContaining({ id: STARTER_SKILL.id, version: STARTER_SKILL.version })]);

    const owned = await playPractice(ana, 0);
    expect(decrypt).toHaveBeenCalledTimes(1);
    const row = (await deps.repos.v2Matches.get(owned.found.matchId))!;
    expect(row.crews!.A[0]!.skills).toEqual([{ id: STARTER_SKILL.id, version: STARTER_SKILL.version }]);
    expect(row.crews!.B[0]!.skills).toEqual([]);
    // The hashed log header never carries the skills.
    expect(JSON.stringify((row.log as { header: unknown }).header)).not.toContain(STARTER_SKILL.id);

    // The skill leaves Ana (this test db holds no other ownership) but stays in Rook's slot.
    await deps.repos.db.delete(skillOwnership);
    await delay(20);
    const sold = await playPractice(ana, 0);
    expect(sold.end.result).not.toBeNull();
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect((await deps.repos.v2Matches.get(sold.found.matchId))!.crews!.A[0]!.skills).toEqual([]);
    expect(warns.some((w) => w.includes(STARTER_SKILL.id) && w.includes('does not own'))).toBe(true);
    // The bought skill no longer runs, so the crew plan is no longer withheld for it.
    const planHidden = (matchId: string) => ana.inbox.ofType('v2_frame').filter((f) => f.matchId === matchId).flatMap((f) => f.frame.agents.filter((a) => a.team === 'A')).map((a) => a.planHidden === true);
    expect(planHidden(owned.found.matchId).every(Boolean)).toBe(true);
    expect(planHidden(sold.found.matchId).some(Boolean)).toBe(false);
  });
});

describe('realtime v2 brain', () => {
  const fakeFetch = (cost: number) =>
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ACTION: 1' } }], usage: { prompt_tokens: 100, completion_tokens: 5, cost } }), { status: 200 }));
  const quiet: Logger = { info() {}, warn() {}, error() {} };

  it('sends every model call’s cost to the CostMonitor', async () => {
    const recorded: number[] = [];
    const brain = createRealtimeV2Brain({ OPENROUTER_API_KEY: 'k' }, { record: async (usd) => void recorded.push(usd) }, quiet, fakeFetch(0.00042));
    expect(brain.kind).toBe('haiku');
    await brain.plan(fakeObservation(), { skills: [] });
    expect(recorded).toEqual([0.00042]);
  });

  it('logs a failed cost update instead of failing the call', async () => {
    const warns: string[] = [];
    const brain = createRealtimeV2Brain({ OPENROUTER_API_KEY: 'k' }, { record: () => Promise.reject(new TypeError('redis down')) }, { ...quiet, warn: (m) => warns.push(m) }, fakeFetch(0.001));
    const r = await brain.plan(fakeObservation(), { skills: [] });
    expect(r.call).toMatchObject({ ok: true, costUsd: 0.001 });
    await delay(5);
    expect(warns).toEqual(['v2 cost total update failed: TypeError']);
  });

  it('is the greedy brain without a key, or with V2_BRAIN=greedy', () => {
    const costs = { record: vi.fn(async () => undefined) };
    expect(createRealtimeV2Brain({}, costs, quiet).kind).toBe('greedy');
    expect(createRealtimeV2Brain({ OPENROUTER_API_KEY: 'k', V2_BRAIN: 'greedy' }, costs, quiet).kind).toBe('greedy');
  });
});

describe('V2_TICK_MS', () => {
  it('defaults to 2 s, takes whole milliseconds and never goes under the minimum', () => {
    expect(parseV2TickMs(undefined)).toBe(2000);
    expect(parseV2TickMs(' ')).toBe(2000);
    expect(parseV2TickMs('250')).toBe(250);
    expect(parseV2TickMs('5')).toBe(V2_TICK_MS_MIN);
    expect(V2_TICK_MS_MIN).toBe(50);
    expect(() => parseV2TickMs('fast')).toThrow(/V2_TICK_MS/);
    expect(() => parseV2TickMs('1.5')).toThrow(/V2_TICK_MS/);
  });
});

/** Any observation will do for a planner call. */
function fakeObservation() {
  const map = MAPS_V2.find((m) => m.id === DEFAULT_PRACTICE.mapId)!;
  return observe(createMatch(map, { A: botCrew(1, 'a'), B: botCrew(1, 'b') }), 'a-1');
}
