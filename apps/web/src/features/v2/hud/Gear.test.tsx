import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { composeV2Arena } from '@/features/arena/live';
import { drawGear2D, gearOf } from '@/features/arena/gear';
import { v2FrameFixture } from '@/test/fixtures';
import { linesOf } from '../v2Store';
import { GearLegend, ToolChip, toolsInFrame } from './Gear';
import { calloutOf } from './model';

const withGear = () => {
  const f = v2FrameFixture({ tick: 41 });
  return {
    ...f,
    tools: [{ at: [20, 12] as [number, number], kind: 'sandbag' as const }],
    placed: [{ at: [10, 6] as [number, number], kind: 'pump' as const, ticksLeft: 2 }],
    agents: f.agents.map((a, i) => (i === 0 ? { ...a, tool: 'bridge' as const } : a)),
  };
};

describe('supply tools in the HUD and the arena', () => {
  it('reads the gear and carried tools off a frame, and nothing on a frame without', () => {
    const f = withGear();
    expect(gearOf(f)).toEqual({ tools: f.tools, placed: f.placed });
    expect(gearOf(v2FrameFixture())).toBeNull();
    expect(toolsInFrame(f)).toEqual(['sandbag', 'pump', 'bridge']);
    expect(toolsInFrame(v2FrameFixture())).toEqual([]);
    const arena = composeV2Arena(f)!;
    expect(arena.state.gear).toEqual({ tools: f.tools, placed: f.placed });
    expect(arena.state.agents[0]!.tool).toBe('bridge');
  });

  it('shows a legend for the tools in play and a chip with a tooltip for a carried tool', () => {
    render(<GearLegend frame={withGear()} />);
    const legend = screen.getByTestId('v2-gear-legend');
    expect(legend.textContent).toContain('Sandbags');
    expect(legend.textContent).toContain('Pump');
    expect(legend.textContent).toContain('Bridge');
    render(<ToolChip kind="pump" onCard />);
    expect(screen.getByTestId('v2-tool-pump').getAttribute('title')).toMatch(/^Pump: Drains water/);
    const { container } = render(<GearLegend frame={v2FrameFixture()} />);
    expect(container.innerHTML).toBe('');
  });

  it('calls out and logs a tool drop and a placed tool', () => {
    const f = v2FrameFixture({ tick: 40 });
    const me = f.agents[0]!;
    const frame = {
      ...f,
      events: [
        { kind: 'tool_dropped' as const, tool: 'sandbag' as const, at: [20, 12] as [number, number] },
        { kind: 'tool_used' as const, agent: me.id, tool: 'pump' as const, at: [me.x + 1, me.y] as [number, number] },
      ],
    };
    expect(calloutOf(frame, me.team)).toEqual({ text: `${me.name} placed the pump`, side: 'you' });
    const lines = linesOf(frame, null).map((l) => l.text);
    expect(lines).toContain('The drop carries sandbags at 20,12.');
    expect(lines).toContain('Placed a pump');
  });

  it('draws ground tools and placed objects on the 2D board', () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k: string) => (typeof k === 'string' && /^(fill|stroke|ellipse|fillRect|fillText|beginPath|save|restore)$/.test(k) ? vi.fn(() => calls.push(k)) : undefined),
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawGear2D(ctx, gearOf(withGear())!, 32, 0, 0, 1.2);
    expect(calls).toContain('fillText');
    expect(calls.filter((c) => c === 'ellipse').length).toBeGreaterThan(2);
  });
});
