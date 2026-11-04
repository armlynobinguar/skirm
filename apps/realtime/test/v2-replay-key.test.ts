import { describe, expect, it } from 'vitest';
import { v2FramesKey } from '../src/v2/replay';

// apps/api reads the watch frames for shared replays under this exact key (apps/api/src/replays.ts).
describe('v2 replay frames key', () => {
  it('stays the key the api reads', () => {
    expect(v2FramesKey('mat_1', 'watch')).toBe('v2:match:mat_1:frames:watch');
  });
});
