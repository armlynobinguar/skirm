import type { FrameAgent } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { EMOTE_LOOK } from '@/features/arena/emotes';
import { posedCrew } from './CrewPoses';

const agents = [
  { agentId: 'wick', name: 'Wick' },
  { agentId: 'moss', name: 'Moss' },
];

describe('the debrief crew line', () => {
  it('dresses agents from the last frame and stands the rest in crew colours', () => {
    const frame = [
      { id: 'wick', role: 'Builder', look: { skin: 2, hair: 'bun', hairColor: 1, outfit: 4, pants: 0, build: 'slim', headgear: 'cap' } },
      { id: 'moss', role: 'Digger', cosmetics: { skin: 'skin_ember' } },
    ] as unknown as FrameAgent[];
    const [wick, moss] = posedCrew(agents, frame, 'A', 'victory', 'moss');
    expect(wick).toMatchObject({ role: 'Builder', body: '#8a5ad6', head: '#d9a477', mvp: false });
    expect(wick!.dress).toMatchObject({ hair: 'bun', headgear: 'cap' });
    expect(moss).toMatchObject({ role: 'Digger', body: '#ff6a3d', head: '#ffd166', mvp: true });
    expect(wick!.emote).toBe(EMOTE_LOOK.won_race);
    expect(moss!.emote).toBe(EMOTE_LOOK.delivered);
  });

  it('works without a frame (a result loaded cold) and picks defeat reactions', () => {
    const crew = posedCrew(agents, null, 'B', 'defeat', null);
    expect(crew.map((a) => a.body)).toEqual(['#ff4655', '#ff8db0']);
    expect(crew[0]!.role).toBeUndefined();
    expect(crew[0]!.emote).toBe(EMOTE_LOOK.lost_race);
    expect(posedCrew(agents, null, 'A', 'draw', null)[1]!.emote).toBe(EMOTE_LOOK.not_fooled);
  });
});
