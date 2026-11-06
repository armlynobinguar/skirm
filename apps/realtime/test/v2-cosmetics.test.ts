// Equipped cosmetics ride on every frame as plain ids (rendering only); the match log and its hash
// chain never see them.
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { MAPS_V2, verifyLog, type AgentSpec, type Team, type V2Frame } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { realScheduler } from '../src/timing';
import { V2Match, withCosmetics, type V2Credits, type V2Setup } from '../src/v2/match';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id.toUpperCase(), role, vision: 3, comms: 3, tier: 'standard' });
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 20, planMs: 40, replanEvery: 25 };
const credits: V2Credits = { hold: async () => ({ ok: true }), charge: async () => {}, settle: async () => {}, release: async () => {} };

function setup(): V2Setup {
  return {
    matchId: 'mat_cos',
    map,
    ranked: false,
    sides: {
      A: {
        accountId: 'acc_a',
        handle: 'ana',
        crew: [spec('wick', 'Builder'), spec('moss', 'Digger')],
        skills: [[], []],
        cosmetics: [{ skin: 'skin_ember', trail: 'trail_spark' }, null],
      },
      B: { accountId: 'acc_b', handle: 'ben', crew: [spec('wren', 'Digger'), spec('kes', 'Runner')], skills: [[], []], cosmetics: [null, { nameplate: 'plate_gold' }] },
    },
  };
}

async function play(s: V2Setup) {
  const inbox: Record<Team | 'watch', V2ServerMessage[]> = { A: [], B: [], watch: [] };
  const brain = createGreedyBrain();
  const m: V2Match = new V2Match(s, {
    brains: { A: brain, B: brain },
    scheduler: realScheduler,
    timing: FAST,
    credits,
    send: (t, msg) => {
      inbox[t].push(msg);
      if (msg.type === 'v2_found') queueMicrotask(() => m.accept(t));
      if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(t, []));
    },
    watch: (msg) => inbox.watch.push(msg),
    log: silentLogger,
  });
  const end = await m.play();
  const frames = (v: Team | 'watch') => inbox[v].flatMap((x) => (x.type === 'v2_frame' ? [x.frame] : []));
  return { end, frames };
}

describe('v2 cosmetics on frames', () => {
  it('puts what each agent wears on every view and keeps it out of the log', async () => {
    const { end, frames } = await play(setup());
    const first = (v: Team | 'watch') => frames(v)[0]!;
    const wick = (f: V2Frame) => f.agents.find((a) => a.id === 'wick');
    expect(wick(first('A'))!.cosmetics).toEqual({ skin: 'skin_ember', trail: 'trail_spark' });
    expect(first('A').agents.find((a) => a.id === 'moss')!.cosmetics).toBeUndefined();
    expect(wick(first('watch'))!.cosmetics).toEqual({ skin: 'skin_ember', trail: 'trail_spark' });
    expect(first('watch').agents.find((a) => a.id === 'kes')!.cosmetics).toEqual({ nameplate: 'plate_gold' });
    // The log and its hash chain never carry them.
    expect(verifyLog(end.log!)).toBeNull();
    expect(JSON.stringify(end.log)).not.toContain('skin_ember');
    expect(JSON.stringify(end.log)).not.toContain('plate_gold');

    const plain = setup();
    delete plain.sides.A.cosmetics;
    delete plain.sides.B.cosmetics;
    const bare = await play(plain);
    expect(bare.frames('watch')[0]!.agents.every((a) => a.cosmetics === undefined)).toBe(true);
  });

  it('withCosmetics leaves a frame alone when nobody wears anything', () => {
    const frame = { agents: [{ id: 'wick' }] } as unknown as V2Frame;
    const sides = { A: { crew: [spec('wick', 'Builder')], cosmetics: [null] }, B: { crew: [] } };
    expect(withCosmetics(frame, sides)).toBe(frame);
  });

  it('withCosmetics copies each owner look onto its agent, beside what it wears', () => {
    const look = { skin: 2, hair: 'bun', hairColor: 3, outfit: 1, pants: 0, build: 'sturdy', headgear: 'cap' };
    const frame = { agents: [{ id: 'wick' }, { id: 'rook' }] } as unknown as V2Frame;
    const sides = {
      A: { crew: [spec('wick', 'Builder'), spec('rook', 'Scout')], cosmetics: [{ trail: 'trail_x' }, null], looks: [null, look] },
      B: { crew: [] },
    };
    const out = withCosmetics(frame, sides);
    expect(out.agents[0]).toEqual({ id: 'wick', cosmetics: { trail: 'trail_x' } });
    expect(out.agents[1]).toEqual({ id: 'rook', look });
    expect(out.agents[1]!.look).not.toBe(look);
  });
});
