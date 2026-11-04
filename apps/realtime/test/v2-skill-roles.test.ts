// Role skill slots at lock-in: the API refuses a skill for another role, so one found in an agent's
// slot when the roster loads is stale; it sits out (never decrypted), like a skill no longer owned.
import { OfficialRepo, STARTER_SKILL, skillVersions } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

describe('v2 role skill slots', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('plays an agent without an equipped skill that is not for its role', async () => {
    const warns: string[] = [];
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain(), log: { info() {}, warn: (m) => warns.push(m), error() {} } });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    const decrypt = vi.fn(deps.vault.decryptSkill.bind(deps.vault));
    deps.vault = { encryptSkill: deps.vault.encryptSkill.bind(deps.vault), decryptSkill: decrypt };
    hub = new RealtimeHub(deps);

    const sock = new FakeSocket();
    const c = hub.connect(sock);
    await hub.message(c, JSON.stringify({ type: 'auth', devUser: 'ana' }));
    const acc = (await deps.repos.accounts.byHandle('ana'))!;
    const [rook] = await deps.repos.agents.listByOwner(acc.id);
    await deps.repos.agents.update(acc.id, rook!.id, { role: 'Builder' });
    expect((await deps.repos.agents.view(rook!.id))!.skills.map((s) => s.id)).toEqual([STARTER_SKILL.id]);
    // Stale: every version (only the starter here) now says Scout only. No API path leaves this; the
    // roster must not trust the slot.
    await deps.repos.db.update(skillVersions).set({ roles: ['Scout'] });

    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    await send({ type: 'v2_queue', crew: [{ agentId: rook!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);

    expect(decrypt).not.toHaveBeenCalled();
    expect((await deps.repos.v2Matches.get(found.matchId))!.crews!.A[0]!.skills).toEqual([]);
    expect(warns.some((w) => w.includes(STARTER_SKILL.id) && w.includes('not for a Builder'))).toBe(true);
  });
});
