// Parity for the six original roles through the greedy brain: the practice bot and the headless
// runs must play every old crew exactly as before Medic, Engineer, Saboteur and Courier existed (the
// observation, legal actions and greedy's choices all feed the log). Pins taken before the new roles.
import { canonicalJson, sha256Hex } from '@skirm/engine';
import { MAPS_V2, type AgentSpec, type MatchEvent, type Role } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, playHeadless } from '../src/v2';

const ORIGINAL: readonly Role[] = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'];

export async function greedyRun(i: number) {
  const def = MAPS_V2[i]!;
  const size = Math.min(3, def.starts.A.length);
  const spec = (team: 'a' | 'b', k: number): AgentSpec => ({
    id: `${team}${k}`,
    name: `${team}${k}`,
    role: ORIGINAL[(k + (team === 'a' ? i : i + 3)) % ORIGINAL.length]!,
    vision: 3,
    comms: 3,
    tier: 'standard',
  });
  const crews = { A: Array.from({ length: size }, (_, k) => spec('a', k)), B: Array.from({ length: size }, (_, k) => spec('b', k)) };
  const events: MatchEvent[][] = [];
  const r = await playHeadless({
    def,
    difficulty: (['easy', 'normal', 'hard'] as const)[i % 3]!,
    crews,
    brains: { A: createGreedyBrain(), B: createGreedyBrain() },
    onTick: (ev) => void events.push([...ev]),
  });
  return { hash: r.logHash, events: sha256Hex(canonicalJson(events)), ticks: r.ticks, score: r.score };
}

describe('greedy parity on the original roles', () => {
  it.each(MAPS_V2.map((m, i) => [m.id, i] as const))('%s plays as before', async (_id, i) => {
    expect(await greedyRun(i)).toEqual(PINS[i]);
  });
});

type Pin = { hash: string; events: string; ticks: number; score: { A: number; B: number } };
/** Taken before the new roles (origin/main), one per map in MAPS_V2 order. */
const PINS: Pin[] = [
  { hash: '1273b95bfc13c54c87cebce3528c5815cae4e50bca3f7a0acc89a739675c6158', events: '96bd7d27ad34b78f6ec7ab6ad59c6ded8a4cab1ad12aac5eaed9ffd2dd1503a9', ticks: 25, score: { A: 0, B: 2 } },
  { hash: '5b1c5ab52830567f7bb2b46e2d4c363acb7acae97c8de11b0935ad0d15ee14f6', events: '4f5a9527733caec0fa099c14d8f1db3dded0f583981897d07ec6ff8763649bd4', ticks: 43, score: { A: 3, B: 0 } },
  { hash: 'df114f21473559fad25f48ada57110a9973892096067be1cfe4754cd0c1a478e', events: 'ccea2c79844943bd21336dfd63b33fffc8adc1bcb5027cbf0bf2e959c8850c2a', ticks: 38, score: { A: 3, B: 2 } },
  { hash: '1cecccd7ab6b934135bbcfba88bf708fadce5fe97d170be3c62593333463722b', events: 'f92a8730e946b0389f6b7f993119c4052bcc0d2a5b41e92eb0413994189c5491', ticks: 46, score: { A: 3, B: 0 } },
  { hash: '27171a074e48ac8db02d79949c1bc9e34f6fc1916c4efe7c591f9184b922b5f3', events: '75189be011778a8be69c45dfc937ffc61e671a50a10cb1768b9bc3a96276253a', ticks: 96, score: { A: 0, B: 4 } },
  { hash: '872f1162a447a7f255360959ff1b9fadd175437404135015a15a79e694adeb15', events: '0dce7f3239cf33677e850724ce8ff0bd5dbb650fe613d1e00f9a86b397621e34', ticks: 55, score: { A: 4, B: 2 } },
  { hash: 'ba715c99417b00129436e3f889efd1b75df8262754c3119eb066e4a3df564b8a', events: 'ea78b2decc9ed48097b0d22c6d8930ffb5803995540cc1bf151a0fe18727583a', ticks: 74, score: { A: 4, B: 0 } },
  { hash: '7cfa248e106c0743b914318b28eff292716ad0a9af72fe166c043f0919cb7022', events: '1a314de6466a2d397ee6ec18e62ce00956b9e7045de2e5f1e3e637fb061a9164', ticks: 150, score: { A: 4, B: 4 } },
  { hash: 'c6ca476a297d4b8ead3065f716ab355ec01faaca678ca2d656c3cd070ec62c01', events: '168d655cf08ae4565bfc96f2c66cfd025e4df6b24627244bbdc3d453d07c6d44', ticks: 135, score: { A: 4, B: 4 } },
  { hash: '4fe3aab8948f6ac6fa7dea650316bd6698bca444581081d774a926c0a30bd3ac', events: 'e2ee42375cd589dd210bb7ed91ea367ec1ba4ad85d8b7951973a6932bd2a67a0', ticks: 133, score: { A: 0, B: 5 } },
];
