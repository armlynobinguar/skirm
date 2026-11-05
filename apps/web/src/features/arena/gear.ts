// Tools from supply drops (engine tools.ts) as the arena draws them: tools waiting on the ground and
// placed sandbags, bridges and pumps, in the 2D board (drawGear2D, over the prototype's renderArena)
// and in the 3D chase cam (scene3d lays them as instanced meshes). The HUD and the legend read the
// names, colours and lines from here too.
import type { ToolKind, V2Frame } from '@skirm/engine/v2';

export interface LiveGear {
  /** Tools on the ground. */
  tools: { at: [number, number]; kind: ToolKind }[];
  /** Placed sandbags and bridges, and pumps still running (their ticks left). */
  placed: { at: [number, number]; kind: ToolKind; ticksLeft?: number }[];
}

export const TOOL_INFO: Readonly<Record<ToolKind, { name: string; colour: string; line: string }>> = {
  sandbag: { name: 'Sandbags', colour: '#c9a46a', line: 'Placed next to the agent: water never spreads onto that tile.' },
  pump: { name: 'Pump', colour: '#5fd3ff', line: 'Drains water around it over 3 ticks, then it is spent.' },
  bridge: { name: 'Bridge', colour: '#b98552', line: 'Laid on a water tile: agents walk across and are never knocked down there.' },
};

/** The frame's gear, or null when there is none. */
export function gearOf(frame: Pick<V2Frame, 'tools' | 'placed'>): LiveGear | null {
  const tools = frame.tools ?? [];
  const placed = frame.placed ?? [];
  return tools.length || placed.length ? { tools, placed } : null;
}

/**
 * Draws the gear on the isometric board: P(x, y) = (ox + (x - y)·T/2, oy + (x + y)·T/4), the
 * tile's top at that point minus the slab. Placed objects sit flat; ground tools bob over a ring.
 */
export function drawGear2D(c: CanvasRenderingContext2D, gear: LiveGear, T: number, ox: number, oy: number, time: number, light?: readonly number[] | null, w = 0) {
  const slab = T * 0.13;
  const P = (x: number, y: number): [number, number] => [ox + ((x - y) * T) / 2, oy + ((x + y) * T) / 4 - slab];
  const lit = (x: number, y: number) => (light && w ? Math.max(0.35, light[y * w + x] ?? 1) : 1);
  c.save();
  for (const p of gear.placed) {
    const [sx, sy] = P(p.at[0], p.at[1]);
    c.globalAlpha = lit(p.at[0], p.at[1]);
    if (p.kind === 'bridge') {
      // Planks across the tile.
      for (let k = -2; k <= 2; k++) {
        c.fillStyle = k % 2 ? '#8a5f37' : TOOL_INFO.bridge.colour;
        c.beginPath();
        c.ellipse(sx + (k * T) / 10, sy + (k * T) / 20, T * 0.32, T * 0.05, Math.atan2(-1, 2), 0, Math.PI * 2);
        c.fill();
      }
    } else if (p.kind === 'sandbag') {
      // A low wall of three bags.
      c.fillStyle = TOOL_INFO.sandbag.colour;
      c.strokeStyle = '#6f5734';
      c.lineWidth = Math.max(1, T / 40);
      for (const [dx, dy] of [[-0.16, 0], [0.16, 0], [0, -0.1]] as const) {
        c.beginPath();
        c.ellipse(sx + dx * T, sy + dy * T - T * 0.04, T * 0.15, T * 0.08, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    } else {
      // A pump: a squat cylinder and a ripple that grows while it drains.
      const ph = (time * 1.4) % 1;
      c.strokeStyle = TOOL_INFO.pump.colour;
      c.globalAlpha *= 1 - ph;
      c.lineWidth = Math.max(1, T / 30);
      c.beginPath();
      c.ellipse(sx, sy, T * (0.3 + ph * 0.7), T * (0.15 + ph * 0.35), 0, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = lit(p.at[0], p.at[1]);
      c.fillStyle = '#2a4a5c';
      c.fillRect(sx - T * 0.1, sy - T * 0.28, T * 0.2, T * 0.26);
      c.fillStyle = TOOL_INFO.pump.colour;
      c.beginPath();
      c.ellipse(sx, sy - T * 0.28, T * 0.1, T * 0.05, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  for (const g of gear.tools) {
    const [sx, sy] = P(g.at[0], g.at[1]);
    const bob = Math.sin(time * 2.6 + g.at[0]) * T * 0.03;
    c.globalAlpha = lit(g.at[0], g.at[1]);
    c.strokeStyle = TOOL_INFO[g.kind].colour;
    c.lineWidth = Math.max(1.2, T / 24);
    c.beginPath();
    c.ellipse(sx, sy, T * 0.3, T * 0.15, 0, 0, Math.PI * 2);
    c.stroke();
    // A crate with the tool's initial.
    c.fillStyle = TOOL_INFO[g.kind].colour;
    c.fillRect(sx - T * 0.13, sy - T * 0.4 + bob, T * 0.26, T * 0.22);
    c.fillStyle = '#10161f';
    c.font = `700 ${Math.max(8, Math.round(T * 0.18))}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(TOOL_INFO[g.kind].name[0]!, sx, sy - T * 0.29 + bob);
  }
  c.restore();
}
