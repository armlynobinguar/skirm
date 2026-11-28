import { act, render, screen } from '@testing-library/react';
import type { FrameAgent } from '@skirm/engine/v2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamView } from '@/features/arena/chase3d';
import { Visor } from './Visor';
import type { DangerBoard } from './visorDanger';

const wick: FrameAgent = { id: 'wick', name: 'Wick', team: 'A', role: 'Builder', x: 4, y: 4, items: [], delivered: 0, down: false, out: false, tier: 'standard' };

let frames: FrameRequestCallback[] = [];
const runFrame = () =>
  act(() => {
    const q = frames;
    frames = [];
    for (const cb of q) cb(16);
  });

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('visor danger edges', () => {
  it('lights the edge facing a hazard amber and a rival red, and clears when they are gone', () => {
    const view = { current: { mode: 'visor', yaw: 0, x: 4, z: 4 } as CamView };
    const grid: (string | null)[] = Array(81).fill(null);
    grid[6 * 9 + 4] = 'water'; // ahead (+z)
    let b: DangerBoard | null = { w: 9, h: 9, grid, agents: [{ team: 'B', x: 2, y: 4 }] }; // rival at -x: the screen's right
    render(<Visor agent={wick} team="A" mapId="copper-hollow" view={view} board={() => b} />);
    runFrame();
    const top = screen.getByTestId('v2-visor-edge-top');
    const right = screen.getByTestId('v2-visor-edge-right');
    expect(Number(top.style.opacity)).toBeGreaterThan(0.3);
    expect(top.dataset.rival).toBeUndefined();
    expect(Number(right.style.opacity)).toBeGreaterThan(0.3);
    expect(right.dataset.rival).toBe('');
    expect(screen.getByTestId('v2-visor-edge-left').style.opacity).toBe('0');
    b = null;
    runFrame();
    expect(top.style.opacity).toBe('0');
    expect(right.dataset.rival).toBeUndefined();
  });
});
