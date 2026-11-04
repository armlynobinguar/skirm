// Crew playbooks over the hub: the player's selected playbook reaches the planner whole and each
// actor as one line, lock-in may pick another or none, the player's own frames name it, and its text
// never leaves the server.
import { OfficialRepo } from '@skirm/db';
import { PLAYBOOK_LINE_CHARS, PLAYBOOK_MAX_CHARS, createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import type { Vault } from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { parseClientMessage } from '../src/protocol';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };
const TEXT = 'Rook hauls every item, Wren scouts and calls hazards on team, Moss blocks the rival lane.';
const OTHER = 'Everyone denies the rival middle items first, then regroups at the delivery point.';

/** Greedy moves; remembers the playbook each call was given. */
function recorder() {
  const seen = { act: new Set<string | null>(), plan: new Set<string | null>() };
  const greedy = createGreedyBrain();
  const brain: V2Brain = {
    kind: 'haiku',
    model: 'fake-haiku',
    async act(o, ctx) {
      seen.act.add(ctx.playbook ?? null);
      return greedy.act(o, ctx);
    },
    async plan(o, ctx) {
      seen.plan.add(ctx.playbook ?? null);
      return { text: 'Rook hauls.' };
    },
  };
  return { brain, seen };
}

async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  const agents = await deps.repos.agents.listByOwner(acc.id);
  return { acc, agents, inbox: sock.inbox, send: (m: unknown) => hub.message(c, JSON.stringify(m)) };
}
type Player = Awaited<ReturnType<typeof player>>;

async function practice(p: Player, lock: Record<string, unknown> = {}) {
  await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
  const found = await p.inbox.next('v2_found');
  await p.send({ type: 'v2_accept', matchId: found.matchId });
  await p.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
  await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'], ...lock });
  return found.matchId;
}

describe('v2 crew playbooks', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  async function setup() {
    const r = recorder();
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: r.brain });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const p = await player(hub, deps, 'ana');
    const vault = deps.vault as Vault;
    const first = await deps.repos.playbooks.create(p.acc.id, 'Haul and scout', await vault.encryptPlaybook(TEXT));
    const second = await deps.repos.playbooks.create(p.acc.id, 'Deny', await vault.encryptPlaybook(OTHER));
    return { ...r, deps, p, first, second };
  }

  it('matches the config limits', () => {
    expect(PLAYBOOK_MAX_CHARS).toBe(DEFAULTS.playbooks.maxChars);
    expect(PLAYBOOK_LINE_CHARS).toBe(DEFAULTS.playbooks.actorLineChars);
  });

  it('plays the selected playbook: the planner and actors get it, frames name it, the text never leaves', async () => {
    const { p, seen } = await setup();
    const matchId = await practice(p);
    await p.inbox.next('v2_end', (m) => m.matchId === matchId, 30_000);
    expect([...seen.plan]).toEqual([TEXT]);
    expect([...seen.act]).toEqual([TEXT]);
    const frames = p.inbox.all.flatMap((m) => (m.type === 'v2_frame' ? [m.frame] : []));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.playbook === 'Haul and scout')).toBe(true);
    expect(JSON.stringify(p.inbox.all)).not.toContain('Rook hauls every item');
  });

  it('lets lock-in pick another playbook, or none', async () => {
    const { p, seen, second } = await setup();
    let matchId = await practice(p, { playbookId: second.id });
    await p.inbox.next('v2_end', (m) => m.matchId === matchId, 30_000);
    expect([...seen.plan]).toEqual([OTHER]);
    const last = p.inbox.all.filter((m) => m.type === 'v2_frame').at(-1);
    expect(last?.type === 'v2_frame' && last.frame.playbook).toBe('Deny');

    seen.plan.clear();
    seen.act.clear();
    matchId = await practice(p, { playbookId: null });
    await p.inbox.next('v2_end', (m) => m.matchId === matchId, 30_000);
    expect([...seen.plan]).toEqual([null]);
    expect([...seen.act]).toEqual([null]);
  });

  it("refuses another player's playbook at lock-in", async () => {
    const { deps, p } = await setup();
    const ben = await player(hub!, deps, 'ben');
    const vault = deps.vault as Vault;
    const theirs = await deps.repos.playbooks.create(ben.acc.id, 'Ben', await vault.encryptPlaybook('Ben plays it safe.'));
    await practice(p, { playbookId: theirs.id });
    expect(await p.inbox.next('error')).toMatchObject({ code: 'not_found' });
  });

  it('parses playbookId on v2_lock_in', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [], playbookId: 'pbk_1' }))).toMatchObject({ ok: true, msg: { playbookId: 'pbk_1' } });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [], playbookId: null }))).toMatchObject({ ok: true, msg: { playbookId: null } });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [], playbookId: 7 }))).toMatchObject({ ok: false, code: 'bad_message' });
  });
});
