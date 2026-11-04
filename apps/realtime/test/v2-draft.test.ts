// Draft mode: between accept and lock-in each crew in turn bans one of the rival's equipped skills
// (by id and public name; the prompt never reaches the other side). A banned skill is unequipped from
// the rival crew for the match (also from a crew swapped in at lock-in), a step not answered in time
// passes, and every ban is in both debriefs. Over the hub: v2_queue {draft} pairs only with draft
// searches, v2_draft / v2_ban run the steps, ranked refuses it.
import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import { STARTER_SKILL, STARTER_SKILL_TEXT } from '@skirm/db';
import { MAPS_V2, type AgentSpec, type Team } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { parseClientMessage } from '../src/protocol';
import { realScheduler } from '../src/timing';
import { v2Pool, v2PoolsMatch } from '../src/v2/hub';
import { V2Match, type V2Credits, type V2Roster, type V2Setup } from '../src/v2/match';
import { FakeSocket, delay, makeDeps, type TestDeps } from './helpers';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id.toUpperCase(), role, vision: 3, comms: 3, tier: 'standard' });
const FAST = { acceptMs: 60, draftStepMs: 60, lockMs: 60, tickMs: 1, actionMs: 40, planMs: 40, replanEvery: 25 };
const SEAL = 'Seal the left tunnel with blocks before the pump starts flooding the lane.';
const RUSH = 'Rush the middle drop on the first tick and carry it home by the short lane.';
const DIG = 'Dig the right wall open first so the runner has a second way home.';

const credits: V2Credits = { hold: async () => ({ ok: true }), charge: async () => {}, settle: async () => {}, release: async () => {} };

function setup(draft = true): V2Setup {
  return {
    matchId: 'mat_draft',
    map,
    ranked: false,
    ...(draft ? { draft } : {}),
    sides: {
      A: {
        accountId: 'acc_a',
        handle: 'ana',
        crew: [spec('wick', 'Builder'), spec('moss', 'Digger')],
        skills: [[SEAL], [SEAL, DIG]],
        skillKeys: [[{ id: 'skl_seal', version: 1 }], [{ id: 'skl_seal', version: 1 }, { id: 'skl_dig', version: 2 }]],
        skillNames: [['Seal Tunnel'], ['Seal Tunnel', 'Wall Opener']],
      },
      B: {
        accountId: 'acc_b',
        handle: 'ben',
        crew: [spec('wren', 'Digger'), spec('kes', 'Runner')],
        skills: [[RUSH], []],
        skillKeys: [[{ id: 'skl_rush', version: 1 }], []],
        skillNames: [['Drop Rush'], []],
      },
    },
  };
}

/** Greedy moves, recording the skill prompts each agent plays with. */
function recorder() {
  const skills = new Map<string, string[]>();
  const planned: Record<string, string[]> = {};
  const greedy = createGreedyBrain();
  const brain: V2Brain = {
    kind: 'greedy',
    model: 'greedy',
    async act(o, ctx) {
      skills.set(o.me.id, [...ctx.skills]);
      return greedy.act(o, ctx);
    },
    async plan(o, ctx) {
      planned[o.me.team] = [...ctx.skills];
      return greedy.plan(o, ctx);
    },
  };
  return { brain, skills, planned };
}

/**
 * A match whose players accept and lock in by themselves; `onDraft` answers each v2_draft a crew
 * gets on its own turn (absent: let the step run out). `lockRoster` is crew B's lock-in roster.
 */
function harness(opts: { draft?: boolean; onDraft?: Partial<Record<Team, (m: V2Match, msg: Extract<V2ServerMessage, { type: 'v2_draft' }>) => void>>; lockRoster?: V2Roster } = {}) {
  const inbox: Record<Team, V2ServerMessage[]> = { A: [], B: [] };
  const rec = recorder();
  const m: V2Match = new V2Match(setup(opts.draft ?? true), {
    brains: { A: rec.brain, B: rec.brain },
    scheduler: realScheduler,
    timing: FAST,
    credits,
    send: (t, msg) => {
      inbox[t].push(msg);
      if (msg.type === 'v2_found') queueMicrotask(() => m.accept(t));
      if (msg.type === 'v2_draft' && msg.turn === t) {
        const fn = opts.onDraft?.[t];
        if (fn) queueMicrotask(() => fn(m, msg));
      }
      if (msg.type === 'v2_lockin' && !m['locked'].has(t)) queueMicrotask(() => m.lockIn(t, [], t === 'B' ? opts.lockRoster : undefined));
    },
    log: silentLogger,
  });
  return { m, inbox, ...rec };
}

const drafts = (msgs: V2ServerMessage[]) => msgs.flatMap((x) => (x.type === 'v2_draft' ? [x] : []));

describe('v2 draft mode', () => {
  it('runs A then B, unequips each ban from the rival crew, and puts the bans in both debriefs', async () => {
    const h = harness({
      onDraft: {
        A: (m, msg) => expect(m.ban('A', msg.pool[0]!.skillId)).toEqual({ ok: true }),
        B: (m, msg) => expect(m.ban('B', msg.pool.find((s) => s.skillId === 'skl_seal')!.skillId)).toEqual({ ok: true }),
      },
    });
    const end = await h.m.play();
    expect(end.result).not.toBeNull();

    // The found card says draft; then a step for A, a step for B and the closing message (turn null).
    expect(h.inbox.A.find((x) => x.type === 'v2_found')).toMatchObject({ draft: true });
    const seen = drafts(h.inbox.A);
    expect(seen.map((d) => d.turn)).toEqual(['A', 'B', null]);
    expect(seen[0]).toMatchObject({ step: 0, steps: 2 * DEFAULTS.draft.bansPerSide, pool: [{ skillId: 'skl_rush', name: 'Drop Rush', agents: 1 }] });
    expect(seen[0]!.stepMs).toBeGreaterThan(0);
    // Each crew's pool is the rival's skills, deduped, with how many rival agents run each.
    expect(drafts(h.inbox.B)[0]!.pool).toEqual([
      { skillId: 'skl_seal', name: 'Seal Tunnel', agents: 2 },
      { skillId: 'skl_dig', name: 'Wall Opener', agents: 1 },
    ]);
    // The prompts never travel: no draft message carries any skill text.
    const wire = JSON.stringify([...drafts(h.inbox.A), ...drafts(h.inbox.B)]);
    for (const p of [SEAL, RUSH, DIG]) expect(wire).not.toContain(p);

    const bans = [
      { team: 'A', step: 0, skillId: 'skl_rush', name: 'Drop Rush' },
      { team: 'B', step: 1, skillId: 'skl_seal', name: 'Seal Tunnel' },
    ];
    expect(seen[2]!.bans).toEqual(bans);
    // Lock-in comes after the draft.
    const types = h.inbox.A.map((x) => x.type);
    expect(types.lastIndexOf('v2_draft')).toBeLessThan(types.indexOf('v2_lockin'));

    // Banned skills are off the rival's agents for the match; the rest still play.
    expect(h.skills.get('wren')).toEqual([]);
    expect(h.skills.get('wick') ?? []).toEqual([]);
    expect(h.skills.get('moss')).toEqual([DIG]);
    expect(h.planned.A).toEqual([DIG]);
    expect(h.m.setup.sides.A.skillKeys).toEqual([[], [{ id: 'skl_dig', version: 2 }]]);

    for (const t of ['A', 'B'] as const) expect(h.m.debrief(t, end, { eloDelta: {}, registry: null }).draft).toEqual({ bans });
  });

  it('passes a step nobody answers, and skips one with nothing to ban', async () => {
    const h = harness({ onDraft: { B: (m) => expect(m.ban('B', null)).toEqual({ ok: true }) } });
    // Crew A has nothing to ban once B's only skill is gone: take it off first.
    h.m.setup.sides.B.skillKeys = [[], []];
    h.m.setup.sides.B.skills = [[], []];
    const end = await h.m.play();
    const last = drafts(h.inbox.A).at(-1)!;
    expect(last.turn).toBeNull();
    expect(last.bans).toEqual([
      { team: 'A', step: 0, skillId: null, name: null },
      { team: 'B', step: 1, skillId: null, name: null },
    ]);
    // A's step was skipped at once: the first step anyone was told of is B's.
    expect(drafts(h.inbox.A)[0]!.turn).toBe('B');
    expect(h.m.debrief('A', end, { eloDelta: {}, registry: null }).draft!.bans).toHaveLength(2);

    const idle = harness();
    const end2 = await idle.m.play();
    expect(end2.result).not.toBeNull();
    expect(drafts(idle.inbox.B).at(-1)!.bans).toEqual([
      { team: 'A', step: 0, skillId: null, name: null, timedOut: true },
      { team: 'B', step: 1, skillId: null, name: null, timedOut: true },
    ]);
    // Nothing was banned, so every skill plays.
    expect(idle.skills.get('moss')).toEqual([SEAL, DIG]);
    expect(idle.skills.get('wren')).toEqual([RUSH]);
  });

  it('refuses a ban out of turn, of a skill the rival does not run, or twice', async () => {
    const results: unknown[] = [];
    const h = harness({
      onDraft: {
        A: (m) => {
          results.push(m.ban('B', 'skl_seal'));
          results.push(m.ban('A', 'skl_seal'));
          results.push(m.ban('A', 'skl_rush'));
          results.push(m.ban('A', 'skl_rush'));
        },
      },
    });
    expect(h.m.ban('A', 'skl_rush')).toMatchObject({ ok: false, code: 'not_your_turn' });
    await h.m.play();
    expect(results).toEqual([
      expect.objectContaining({ ok: false, code: 'not_your_turn' }),
      expect.objectContaining({ ok: false, code: 'invalid_ban' }),
      { ok: true },
      expect.objectContaining({ ok: false, code: 'not_your_turn' }),
    ]);
    expect(h.m.ban('B', null)).toMatchObject({ ok: false, code: 'not_your_turn' });
  });

  it('keeps a banned skill off a crew swapped in at lock-in', async () => {
    const roster: V2Roster = {
      crew: [spec('pike', 'Runner')],
      skills: [[RUSH, DIG]],
      skillKeys: [[{ id: 'skl_rush', version: 1 }, { id: 'skl_dig', version: 1 }]],
      skillNames: [['Drop Rush', 'Wall Opener']],
    };
    const h = harness({ onDraft: { A: (m) => m.ban('A', 'skl_rush') }, lockRoster: roster });
    await h.m.play();
    expect(h.skills.get('pike')).toEqual([DIG]);
    expect(h.m.setup.sides.B.skillKeys).toEqual([[{ id: 'skl_dig', version: 1 }]]);
  });

  it('has no ban phase outside draft mode', async () => {
    const h = harness({ draft: false });
    const end = await h.m.play();
    expect(drafts(h.inbox.A)).toHaveLength(0);
    expect(h.inbox.A.find((x) => x.type === 'v2_found')).not.toHaveProperty('draft');
    expect(h.m.debrief('A', end, { eloDelta: {}, registry: null })).not.toHaveProperty('draft');
    expect(h.skills.get('wren')).toEqual([RUSH]);
  });
});

describe('v2 draft protocol and pools', () => {
  const crew = [{ agentId: 'agt_1', tier: 'standard' }];
  it('parses draft on a casual queue and v2_ban, and refuses draft in ranked or practice', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, draft: true }))).toMatchObject({ ok: true, msg: { draft: true } });
    const plain = parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, draft: false }));
    expect(plain.ok && 'draft' in plain.msg).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: true, draft: true }))).toMatchObject({ ok: false, code: 'draft_casual' });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, draft: true, opponent: 'bot' }))).toMatchObject({ ok: false, code: 'draft_casual' });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, draft: 'yes' }))).toMatchObject({ ok: false, code: 'bad_message' });

    expect(parseClientMessage(JSON.stringify({ type: 'v2_ban', matchId: 'mat_1', skillId: 'skl_1' }))).toEqual({ ok: true, msg: { type: 'v2_ban', matchId: 'mat_1', skillId: 'skl_1' } });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_ban', matchId: 'mat_1', skillId: null }))).toEqual({ ok: true, msg: { type: 'v2_ban', matchId: 'mat_1', skillId: null } });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_ban', matchId: 'mat_1' }))).toMatchObject({ ok: false, code: 'bad_message' });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_ban', matchId: 'mat_1', skillId: 'a b' }))).toMatchObject({ ok: false, code: 'bad_message' });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_ban', matchId: 'mat_1', skillId: null, prompt: 'x' }))).toMatchObject({ ok: false, code: 'bad_message' });
  });

  it('pairs draft searches only with draft searches', () => {
    const draft = v2Pool({ ranked: false, mapId: 'copper-hollow', difficulty: 'normal', draft: true });
    const anyDraft = v2Pool({ ranked: false, difficulty: 'normal', draft: true });
    const casual = v2Pool({ ranked: false, mapId: 'copper-hollow', difficulty: 'normal' });
    expect(casual).toBe('copper-hollow|normal');
    expect(v2PoolsMatch(draft, anyDraft)).toBe(true);
    expect(v2PoolsMatch(draft, casual)).toBe(false);
    expect(v2PoolsMatch(anyDraft, v2Pool({ ranked: false, difficulty: 'normal' }))).toBe(false);
    expect(v2PoolsMatch(anyDraft, v2Pool({ ranked: false, difficulty: 'hard', draft: true }))).toBe(false);
  });
});

describe('v2 draft over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  async function player(h: RealtimeHub, deps: TestDeps, handle: string) {
    const sock = new FakeSocket();
    const c = h.connect(sock);
    await h.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
    const acc = (await deps.repos.accounts.byHandle(handle))!;
    await deps.repos.ledger.topUp({ accountId: acc.id, credits: 2000 });
    const agents = await deps.repos.agents.listByOwner(acc.id);
    // Rook carries the starter skill (Flood Warden).
    const rook = agents.find((a) => a.name === STARTER_SKILL.equipOn)!;
    const send = (m: unknown) => h.message(c, JSON.stringify(m));
    return { sock, acc, rook, send, inbox: sock.inbox };
  }

  it('queues draft casual, bans the rival’s skill by id, plays without it and records the bans', async () => {
    const deps = await makeDeps({ v2Timing: { acceptMs: 500, draftStepMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 } });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const cy = await player(hub, deps, 'cy');
    const q = (p: Awaited<ReturnType<typeof player>>, extra: Record<string, unknown>) =>
      p.send({ type: 'v2_queue', crew: [{ agentId: p.rook.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow', difficulty: 'normal', ...extra });

    // Ranked refuses it; a plain casual search never meets a draft one.
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.rook.id, tier: 'standard' }], ranked: true, draft: true });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'draft_casual' });
    await q(ana, { draft: true });
    await q(cy, {});
    await delay(80);
    expect(ana.inbox.ofType('v2_found')).toHaveLength(0);
    await q(ben, { draft: true });
    const found = await ana.inbox.next('v2_found');
    expect(found).toMatchObject({ draft: true, ranked: false });
    expect(cy.inbox.ofType('v2_found')).toHaveLength(0);

    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    const step = await ana.inbox.next('v2_draft');
    expect(step).toMatchObject({ turn: 'A', pool: [{ skillId: STARTER_SKILL.id, name: STARTER_SKILL.name, agents: 1 }] });
    expect(JSON.stringify(step)).not.toContain(STARTER_SKILL_TEXT.prompt.slice(0, 40));
    // Not Ben's turn yet.
    await ben.send({ type: 'v2_ban', matchId: found.matchId, skillId: STARTER_SKILL.id });
    expect(await ben.inbox.next('error')).toMatchObject({ code: 'not_your_turn' });
    await ana.send({ type: 'v2_ban', matchId: found.matchId, skillId: STARTER_SKILL.id });
    await ben.inbox.next('v2_draft', (m) => m.turn === 'B');
    await ben.send({ type: 'v2_ban', matchId: found.matchId, skillId: null });
    const done = await ana.inbox.next('v2_draft', (m) => m.turn === null);
    expect(done.bans).toEqual([
      { team: 'A', step: 0, skillId: STARTER_SKILL.id, name: STARTER_SKILL.name },
      { team: 'B', step: 1, skillId: null, name: null },
    ]);

    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    expect(end.result).not.toBeNull();
    expect(end.debrief!.draft!.bans).toEqual(done.bans);

    // Ben's Rook played without the banned skill; Ana's kept it. The stored debriefs carry the bans.
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row.crews!.B[0]!.skills).toEqual([]);
    expect(row.crews!.A[0]!.skills).toEqual([{ id: STARTER_SKILL.id, version: STARTER_SKILL.version }]);
    expect(row.debriefs!.B!.draft!.bans).toEqual(done.bans);
  });
});
