// The agent figure on the isometric canvas (the overview board, the 2D third person and the
// portraits): the role's look from @skirm/ui's ROLE_LOOKS projected to polygons, posed by what the
// agent is doing this frame (bob, walk, carry, verb, knocked down, stunned, celebrating), with the
// crew ring, carried items and the verb's effect. The prototype's drawAgent calls this.
import {
  ISO_V,
  dressLook,
  isoPolys,
  lookFor,
  lookTop,
  poseAt,
  poseKind,
  type Dress,
  type Pose,
  type RoleLook,
  type Social,
} from '@skirm/ui';

/** An agent as the 2D board knows it (the prototype's agent object plus the live status). */
export interface Figure2DAgent {
  c?: string;
  bone?: string;
  team?: 'A' | 'B';
  slot?: number;
  role?: string;
  out?: boolean;
  down?: boolean;
  stun?: boolean;
  /** The verb effect used this frame (live frames). */
  act?: string | null;
  /** Delivered this frame. */
  cheer?: boolean;
  /** The match is over: loop the victory or defeat pose (debrief portraits). */
  result?: 'victory' | 'defeat' | null;
  inv?: readonly unknown[];
  /** How its owner dressed it (hair, trousers, build, headgear). Absent: the role's plain look. */
  dress?: Dress;
  /** Which way it faces on screen: 1 toward the lower right, -1 toward the lower left. Absent: its crew's side. */
  face?: 1 | -1;
  /** How it reacts to the others this frame (talk, listen, think, ...; render only). */
  social?: Social;
}

/** The look this agent wears: its role's, dressed when its owner chose a look. */
export function figureLook(a: Pick<Figure2DAgent, 'role' | 'dress'>): RoleLook {
  const base = lookFor(a.role);
  return a.dress ? dressLook(base, a.dress) : base;
}

export interface Figure2DOpts {
  /** Crew ring colour (none: no ring). */
  team?: string;
  /** Pulsing focus ring. */
  ring?: boolean;
  /** Carried item colour. */
  item?: string;
  alpha?: number;
  /** Seconds since this frame arrived (one-shot poses: fall, celebration). */
  age?: number;
  /** Stepping between tiles; `walk` is the step's progress 0–1. */
  moving?: boolean;
  walk?: number;
  /** Reduced motion: fixed poses, no orbiting stars or particles. */
  still?: boolean;
}

/** The pose the figure takes this moment (pure; the tests read it). */
export function figurePose(
  a: Figure2DAgent,
  look: RoleLook,
  time: number,
  opts: Figure2DOpts = {},
): Pose {
  const kind = poseKind({
    out: a.out,
    down: a.down,
    stun: a.stun,
    cheer: a.cheer,
    result: a.result,
    act: a.act,
    carrying: a.inv?.length ?? 0,
    moving: opts.moving,
  });
  return poseAt(kind, look, {
    time,
    age: opts.age ?? 9,
    walk: opts.walk,
    still: opts.still,
    seed: (a.slot ?? 0) + (a.team === 'B' ? 2 : 0),
    social: a.social ?? null,
  });
}

function fill(c: CanvasRenderingContext2D, pts: readonly number[], T: number, col: string) {
  c.beginPath();
  c.moveTo(pts[0]! * T, pts[1]! * T);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]! * T, pts[i + 1]! * T);
  c.closePath();
  c.fillStyle = col;
  c.fill();
}

function diamond(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  c.beginPath();
  c.moveTo(x, y - r * 1.3);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
  c.fillStyle = col;
  c.fill();
}

/**
 * Draws one agent with its feet at (sx, b) on a board of tile size T. `hop` lifts it (moves
 * between tiles, the drop-in). Returns nothing; leaves globalAlpha at 1.
 */
export function drawFigure(
  c: CanvasRenderingContext2D,
  sx: number,
  b: number,
  T: number,
  a: Figure2DAgent,
  time: number,
  hop: number,
  opts: Figure2DOpts = {},
) {
  const ba = opts.alpha ?? 1;
  const look = figureLook(a);
  const pose = figurePose(a, look, time, opts);
  const still = !!opts.still;
  const dir: 1 | -1 = a.face ?? (a.team === 'B' ? -1 : 1);
  const faded = a.out ? 0.45 : a.down ? 0.75 : 1;
  c.save();
  c.globalAlpha = ba;
  // Shadow, crew ring, focus ring.
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.beginPath();
  c.ellipse(sx, b, T * 0.22, T * 0.11, 0, 0, 7);
  c.fill();
  if (opts.team) {
    c.strokeStyle = opts.team;
    c.lineWidth = Math.max(1.5, T / 26);
    c.globalAlpha = 0.9 * ba;
    c.beginPath();
    c.ellipse(sx, b, T * 0.3, T * 0.15, 0, 0, 7);
    c.stroke();
  }
  if (opts.ring) {
    c.strokeStyle = '#ffb547';
    c.lineWidth = Math.max(1.5, T / 28);
    c.globalAlpha = (still ? 0.85 : 0.6 + 0.4 * Math.sin(time * 5)) * ba;
    c.beginPath();
    c.ellipse(sx, b, T * 0.4, T * 0.2, 0, 0, 7);
    c.stroke();
  }
  c.globalAlpha = faded * ba;
  // Ground effects under the figure: the scout pulse ring.
  if (pose.kind === 'act' && look.verb === 'pulse') {
    const k = still ? 0.6 : (time * 0.9) % 1;
    c.strokeStyle = look.accent;
    c.lineWidth = Math.max(1.2, T / 30);
    c.globalAlpha = (still ? 0.5 : 1 - k) * ba;
    c.beginPath();
    c.ellipse(sx, b, T * (0.3 + k * 0.9), T * (0.15 + k * 0.45), 0, 0, 7);
    c.stroke();
    c.globalAlpha = faded * ba;
  }
  const y0 = b - hop - pose.lift * T * ISO_V;
  c.translate(sx, y0);
  if (pose.tilt) c.rotate(pose.tilt * dir);
  const team = opts.team ?? (a.team === 'B' ? '#ff4655' : '#34e0c8');
  for (const q of isoPolys(look, { body: a.c ?? '#34e0c8', head: a.bone ?? '#ece8e1', team }, dir, pose))
    fill(c, q.pts, T, q.fill);
  c.restore();
  c.save();
  c.globalAlpha = faded * ba;
  // Screen direction the agent faces, per tile step (for effects in front of it).
  const fx = dir * 0.5 * T;
  const fy = 0.25 * T;
  const headY = y0 - (lookTop(look) + 0.06) * T * ISO_V;
  if (!a.down && !a.out)
    drawCarry(c, sx, headY, T, a.inv?.length ?? 0, look, opts.item ?? '#4fd6f2', time, still);
  if (pose.kind === 'stun') {
    for (let i = 0; i < 5; i++) {
      const ang = (still ? 0 : time * 6) + i * 1.25;
      star(
        c,
        sx + Math.cos(ang) * T * 0.22,
        headY - T * 0.04 + Math.sin(ang) * T * 0.07,
        T * 0.035,
        '#ffd23f',
      );
    }
  }
  if (pose.kind === 'act')
    verbFx(c, look, sx + fx * 0.55, b + fy * 0.55, T, time, still, pose.fx, dir);
  if (pose.kind === 'defeat') drawRainCloud(c, sx, headY - T * 0.18, T, time, still);
  if (a.social?.think && (pose.kind === 'idle' || pose.kind === 'carry')) drawThought(c, sx + dir * T * 0.16, headY - T * 0.14, T, time, still);
  if ((pose.kind === 'cheer' || pose.kind === 'victory') && pose.fx > 0) {
    c.globalAlpha = pose.fx * ba;
    for (let i = 0; i < 7; i++) {
      const ang = i * 0.9 + (still ? 0 : time * 2);
      const r = T * (0.25 + (still ? 0.1 : (1 - pose.fx) * 0.25));
      star(
        c,
        sx + Math.cos(ang) * r,
        headY - T * 0.1 + Math.sin(ang) * r * 0.5,
        T * 0.035,
        i % 2 ? '#ffd23f' : (opts.team ?? '#34e0c8'),
      );
    }
  }
  c.restore();
  c.globalAlpha = 1;
}

/** A small grey cloud with a few drops falling, over a defeated agent. */
function drawRainCloud(c: CanvasRenderingContext2D, x: number, y: number, T: number, time: number, still: boolean) {
  const base = c.globalAlpha;
  c.fillStyle = '#8d97a6';
  for (const [dx, dy, r] of [[-0.09, 0.01, 0.07], [0, -0.03, 0.09], [0.09, 0.01, 0.07]] as const) {
    c.beginPath();
    c.arc(x + dx * T, y + dy * T, r * T, 0, 7);
    c.fill();
  }
  c.fillStyle = '#5fb8ff';
  for (let i = 0; i < 3; i++) {
    const ph = still ? 0.5 : (time * 1.6 + i / 3) % 1;
    c.globalAlpha = base * (still ? 0.8 : 1 - ph);
    c.fillRect(x + (i - 1) * T * 0.08 - T * 0.008, y + T * (0.07 + ph * 0.14), T * 0.016, T * 0.04);
  }
  c.globalAlpha = base;
}

/** Carried items over the head: one diamond each, and the count for roles that carry more (Haulers). */
function drawCarry(
  c: CanvasRenderingContext2D,
  sx: number,
  y: number,
  T: number,
  n: number,
  look: RoleLook,
  col: string,
  time: number,
  still: boolean,
) {
  if (n <= 0) return;
  const shown = Math.min(n, look.carry);
  const bob = still ? 0 : Math.sin(time * 2.4) * T * 0.015;
  const step = T * 0.12;
  for (let i = 0; i < shown; i++)
    diamond(c, sx - ((shown - 1) * step) / 2 + i * step, y - T * 0.04 + bob, T * 0.05, col);
  if (look.count) {
    const fs = Math.max(9, Math.round(T * 0.16));
    const x = sx + (shown * step) / 2 + T * 0.04;
    const ty = y - T * 0.04 + bob;
    c.font = `700 ${fs}px "JetBrains Mono", monospace`;
    const label = `${n}/${look.carry}`;
    const w = c.measureText(label).width + fs * 0.5;
    c.fillStyle = 'rgba(5,8,13,.85)';
    c.fillRect(x, ty - fs * 0.62, w, fs * 1.18);
    c.fillStyle = col;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(label, x + fs * 0.25, ty);
    c.textAlign = 'start';
    c.textBaseline = 'alphabetic';
  }
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  c.fillStyle = col;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.4 : r;
    const ang = (i * Math.PI) / 4;
    c.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  c.closePath();
  c.fill();
}

/** The verb's effect in front of the agent, at (x, y) on the ground. */
function verbFx(
  c: CanvasRenderingContext2D,
  look: RoleLook,
  x: number,
  y: number,
  T: number,
  time: number,
  still: boolean,
  k: number,
  dir: 1 | -1,
) {
  const base = c.globalAlpha;
  const t = still ? 0.4 : time;
  switch (look.verb) {
    case 'dig':
      // Dirt clods kicked up.
      for (let i = 0; i < 4; i++) {
        const ph = (t * 1.8 + i / 4) % 1;
        c.globalAlpha = base * (still ? 0.8 : 1 - ph);
        c.fillStyle = i % 2 ? '#7a5a3a' : '#a07850';
        c.fillRect(
          x + (i - 1.5) * T * 0.07,
          y - Math.sin(ph * Math.PI) * T * 0.3 - T * 0.02,
          T * 0.05,
          T * 0.05,
        );
      }
      break;
    case 'build': {
      // A block rising in front.
      const h = T * 0.16 * (still ? 1 : 0.4 + 0.6 * k);
      const hw = T * 0.12;
      c.globalAlpha = base * 0.95;
      c.fillStyle = '#2c7a74';
      c.beginPath();
      c.moveTo(x - hw, y - h);
      c.lineTo(x, y - h + hw / 2);
      c.lineTo(x, y + hw / 2);
      c.lineTo(x - hw, y);
      c.fill();
      c.fillStyle = '#1f5c57';
      c.beginPath();
      c.moveTo(x + hw, y - h);
      c.lineTo(x, y - h + hw / 2);
      c.lineTo(x, y + hw / 2);
      c.lineTo(x + hw, y);
      c.fill();
      c.fillStyle = '#7ff5e4';
      c.beginPath();
      c.moveTo(x, y - h - hw / 2);
      c.lineTo(x + hw, y - h);
      c.lineTo(x, y - h + hw / 2);
      c.lineTo(x - hw, y - h);
      c.fill();
      break;
    }
    case 'spray':
      // Water droplets arcing out of the nozzle.
      for (let i = 0; i < 6; i++) {
        const ph = (t * 2.2 + i / 6) % 1;
        c.globalAlpha = base * (still ? 0.7 : 1 - ph * 0.7);
        c.fillStyle = i % 2 ? '#8fd0ff' : '#e8f8ff';
        c.beginPath();
        c.arc(x + (ph - 0.3) * T * 0.4 * dir, y - T * 0.32 + ph * ph * T * 0.3, T * 0.025, 0, 7);
        c.fill();
      }
      break;
    case 'heal':
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.8 + i / 3) % 1;
        c.globalAlpha = base * (still ? 0.8 : 1 - ph);
        c.fillStyle = '#ff4d5e';
        const px = x + (i - 1) * T * 0.12;
        const py = y - T * (0.3 + ph * 0.4);
        c.fillRect(px - T * 0.03, py - T * 0.01, T * 0.06, T * 0.02);
        c.fillRect(px - T * 0.01, py - T * 0.03, T * 0.02, T * 0.06);
      }
      break;
    case 'wrench':
    case 'spark':
      for (let i = 0; i < 5; i++) {
        const ang = i * 1.3 + t * 9;
        c.globalAlpha = base * (still ? 0.8 : 0.5 + 0.5 * Math.abs(Math.sin(ang)));
        star(
          c,
          x + Math.cos(ang) * T * 0.1,
          y - T * 0.25 + Math.sin(ang) * T * 0.06,
          T * 0.025,
          look.verb === 'spark' ? '#ffb547' : '#ffe94a',
        );
      }
      break;
    case 'pulse':
      break;
    default:
      c.globalAlpha = base * 0.85;
      star(c, x, y - T * 0.4, T * 0.04, look.accent);
  }
  c.globalAlpha = base;
}

/** A small thought cloud with three dots that light up in turn (an agent deciding its next move). */
function drawThought(c: CanvasRenderingContext2D, x: number, y: number, T: number, time: number, still: boolean) {
  const r = T * 0.11;
  c.save();
  c.fillStyle = 'rgba(236,232,225,.92)';
  c.beginPath();
  c.ellipse(x, y, r * 1.5, r, 0, 0, 7);
  c.fill();
  // The trail of small puffs down toward the head.
  c.beginPath();
  c.arc(x - r * 0.9, y + r * 1.25, r * 0.28, 0, 7);
  c.arc(x - r * 1.3, y + r * 1.75, r * 0.16, 0, 7);
  c.fill();
  for (let i = 0; i < 3; i++) {
    const on = still ? 1 : 0.35 + 0.65 * Math.max(0, Math.sin(time * 5 - i * 0.9));
    c.fillStyle = `rgba(20,28,38,${on.toFixed(3)})`;
    c.beginPath();
    c.arc(x + (i - 1) * r * 0.7, y, r * 0.18, 0, 7);
    c.fill();
  }
  c.restore();
}
