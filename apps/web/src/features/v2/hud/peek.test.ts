import type { FrameAgent } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { nextPeek, peekMates } from './peek';

const ag = (id: string, team: 'A' | 'B', o: Partial<FrameAgent> = {}): FrameAgent => ({ id, name: id, team, role: 'Runner', x: 0, y: 0, items: [], delivered: 0, down: false, out: false, tier: 'standard', ...o });

describe('peek through a teammate', () => {
  const agents = [ag('wick', 'A'), ag('moss', 'A'), ag('reed', 'A', { out: true }), ag('fern', 'A'), ag('wren', 'B')];

  it('offers your crewmates still in the match, never the watched one or a rival', () => {
    expect(peekMates(agents, 'wick', 'A').map((a) => a.id)).toEqual(['moss', 'fern']);
    // Watching a rival: its crewmates are behind the fog.
    expect(peekMates(agents, 'wren', 'A')).toEqual([]);
    expect(peekMates(agents, null, 'A')).toEqual([]);
  });

  it('cycles through them press by press', () => {
    const mates = peekMates(agents, 'wick', 'A');
    expect(nextPeek(mates, null)).toBe('moss');
    expect(nextPeek(mates, 'moss')).toBe('fern');
    expect(nextPeek(mates, 'fern')).toBe('moss');
    expect(nextPeek(mates, 'gone')).toBe('moss');
    expect(nextPeek([], null)).toBeNull();
  });
});
