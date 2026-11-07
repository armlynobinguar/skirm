import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { inspectTile } from './inspectInfo';

function find(rows: readonly string[], ch: string): [number, number] {
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y]!.indexOf(ch);
    if (x >= 0) return [x, y];
  }
  throw new Error(`no ${ch}`);
}

describe('inspecting the board', () => {
  const frame = v2FrameFixture();

  it('names tiles in the map’s own words and says what they do', () => {
    // A spectator sees the whole board (a crew's own frame may not have found the exit yet).
    const all = v2FrameFixture({}, 'watch');
    const [ex, ey] = find(all.rows, 'E');
    const exit = inspectTile(all, ex, ey, 2000)!;
    expect(exit.kind).toBe('Delivery point');
    expect(exit.lines[0]).toContain(`First crew to ${all.goal} wins`);
    const [wx, wy] = find(frame.rows, '#');
    expect(inspectTile(frame, wx, wy, 2000)).toMatchObject({ kind: 'Wall', lines: ['Solid: nothing moves through it.'] });
  });

  it('describes an agent on the tile, your own as your crew', () => {
    const a = frame.agents.find((g) => g.team === frame.view)!;
    expect(inspectTile(frame, a.x, a.y, 2000)).toMatchObject({ kind: 'Your crew', title: a.name, agentId: a.id, tone: 'you' });
  });

  it('says an unseen tile is out of sight, and nothing off the board', () => {
    const rows = frame.rows.map((r, y) => (y === 1 ? r.slice(0, 1) + '?' + r.slice(2) : r));
    expect(inspectTile({ ...frame, rows, agents: [] }, 1, 1, 2000)).toMatchObject({ kind: 'Unseen' });
    expect(inspectTile(frame, 999, 999, 2000)).toBeNull();
  });

  it('times a supply drop still to come and names a hazard with its spread', () => {
    const rows = frame.rows.map((r, y) => (y === 1 ? r.slice(0, 2) + '~' + r.slice(3) : r));
    const water = inspectTile({ ...frame, rows, agents: [] }, 2, 1, 2000)!;
    expect(water.kind).toBe('Hazard');
    expect(water.tone).toBe('hazard');
  });
});
