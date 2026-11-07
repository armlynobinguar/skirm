import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, createArenaStore } from './store';

describe('match board zoom', () => {
  it('clamps the zoom and goes back to fit when the match leaves the arena', () => {
    const s = createArenaStore();
    expect(s.get().zoom).toBe(1);
    s.setLive({ A: {}, state: { grid: [], agents: [] } } as never);
    s.setZoom(1.44);
    expect(s.get().zoom).toBe(1.44);
    s.setZoom(99);
    expect(s.get().zoom).toBe(ZOOM_MAX);
    s.setZoom(0.01);
    expect(s.get().zoom).toBe(ZOOM_MIN);
    s.setLive(null);
    expect(s.get().zoom).toBe(1);
  });
});
