import { act, render, screen } from '@testing-library/react';
import type { FrameAgent } from '@skirm/engine/v2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamView } from '@/features/arena/chase3d';
import { Visor } from './Visor';

const wick: FrameAgent = { id: 'wick', name: 'Wick', team: 'A', role: 'Builder', x: 1, y: 1, items: [], delivered: 0, down: false, out: false, tier: 'standard' };

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

describe('visor supply drops', () => {
  it('pips the nearest tools on the ground with their name and distance', () => {
    const view = { current: { mode: 'visor', yaw: 0, x: 1, z: 1 } as CamView };
    const tools = [
      { at: [1, 4] as [number, number], kind: 'pump' as const },
      { at: [3, 1] as [number, number], kind: 'sandbag' as const },
      { at: [30, 15] as [number, number], kind: 'bridge' as const },
    ];
    render(<Visor agent={wick} team="A" mapId="copper-hollow" view={view} tools={tools} />);
    const pips = screen.getAllByTestId('v2-visor-tool');
    // The far bridge is out of range; the nearest comes first.
    expect(pips.map((p) => p.dataset.kind)).toEqual(['sandbag', 'pump']);
    runFrame();
    // Facing +z, the pump is dead ahead and the sandbags (at +x) are to the left: jsdom lays the
    // tape out zero wide, so anything off centre is past its edge and points the way to turn.
    expect(pips[1]).toHaveTextContent(/^Pump · 3 m$/);
    expect(pips[1]!.style.transform).toBe('translateX(calc(-50% + 0.0px))');
    expect(pips[0]).toHaveTextContent('◂ Sandbags · 2 m');
  });

  it('shows the carried tool as a kit chip, and nothing without one', () => {
    const view = { current: null };
    const { rerender } = render(<Visor agent={wick} team="A" mapId="copper-hollow" view={view} />);
    expect(screen.queryByTestId('v2-visor-kit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v2-visor-tool')).not.toBeInTheDocument();
    rerender(<Visor agent={{ ...wick, tool: 'sandbag' }} team="A" mapId="copper-hollow" view={view} />);
    expect(screen.getByTestId('v2-visor-kit')).toHaveTextContent('Kit · Sandbags');
    expect(screen.getByTestId('v2-visor-kit')).toHaveTextContent('water never spreads onto that tile');
  });
});
