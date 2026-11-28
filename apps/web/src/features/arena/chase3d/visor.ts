// The visor's plain maths (first person from the watched agent, the prototype's voxel-pov visor):
// where the eye sits and what it looks at, the compass heading, and where a marker lands on the
// compass tape. Free of `three`, like ./math, so it is unit-tested without WebGL.
//
// Ground plane: x is the column, z the row. Yaw 0 faces +z (down the board, south), π/2 faces +x
// (east). North is towards row 0.

/** The eye's height over the floor: about the visor slit of a figure scaled 1.1. */
export const VISOR_EYE = 0.82;
/** A wider lens than the chase cam's 58°, as the prototype's 70°. */
export const VISOR_FOV = 70;
export const CHASE_FOV = 58;
/** How far up or down the visor can tilt (radians). */
export const PITCH_MAX = 1.1;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The eye at the agent and the point it looks at, along `yaw`, tilted by `pitch` (up is positive). */
export function visorRig(focus: { x: number; z: number }, yaw: number, pitch = 0, eye = VISOR_EYE): { pos: Vec3; look: Vec3 } {
  const p = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch));
  const c = Math.cos(p);
  // The eye sits a touch forward of the agent's centre, so its own head never fills the lens.
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const pos = { x: focus.x + fx * 0.12, y: eye, z: focus.z + fz * 0.12 };
  return { pos, look: { x: pos.x + fx * c, y: eye + Math.sin(p), z: pos.z + fz * c } };
}

/** Wraps degrees into [0, 360). */
export function wrap360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Wraps radians into (-π, π]. */
function wrapPi(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** The compass heading for a yaw, in degrees: 0 north (towards row 0), 90 east, 180 south, 270 west. */
export function headingDeg(yaw: number): number {
  return wrap360(180 - (yaw * 180) / Math.PI);
}

export interface Bearing {
  /** Degrees off the view's centre: positive to the right, negative to the left, in (-180, 180]. */
  rel: number;
  /** Tiles away, straight line. */
  dist: number;
}

/** Where `to` lies from `from` for a viewer facing `yaw`. */
export function bearingTo(from: { x: number; z: number }, to: { x: number; z: number }, yaw: number): Bearing {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { rel: 0, dist: 0 };
  // A turn towards +x from yaw 0 is a turn to the left on screen (the camera's right is -x).
  const rel = -(wrapPi(Math.atan2(dx, dz) - yaw) * 180) / Math.PI;
  return { rel: rel === -180 ? 180 : rel + 0, dist };
}

/** Compass tape: one cell per 15°, `cellPx` wide. */
export const TAPE_STEP = 15;

export interface TapeCell {
  deg: number;
  label: string;
  cardinal: boolean;
}

const CARD: Readonly<Record<number, string>> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** One turn of the tape: N, E, S, W, the 45s as numbers, dots between. */
export function tapeCells(): TapeCell[] {
  const out: TapeCell[] = [];
  for (let d = 0; d < 360; d += TAPE_STEP) out.push({ deg: d, label: CARD[d] ?? (d % 45 === 0 ? String(d) : '·'), cardinal: d in CARD });
  return out;
}

/**
 * How far to shift a strip of three tape turns (cells centred on their degree) so `heading` sits
 * under the tape's middle. The middle turn is used, so the strip never shows an empty end.
 */
export function tapeShift(heading: number, cellPx: number, tapeW: number): number {
  const px = cellPx / TAPE_STEP;
  return tapeW / 2 - (360 + wrap360(heading)) * px - cellPx / 2;
}

export interface TapeMark {
  /** Pixels from the tape's centre (clamped to its half width). */
  x: number;
  /** Past the tape's edge: an arrow points the way to turn. */
  off: 'left' | 'right' | null;
}

/** A marker's place on a tape `tapeW` wide for a bearing `rel` degrees off centre. */
export function tapeMark(rel: number, cellPx: number, tapeW: number): TapeMark {
  const px = cellPx / TAPE_STEP;
  const half = tapeW / 2 / px;
  if (rel > half) return { x: half * px, off: 'right' };
  if (rel < -half) return { x: -half * px, off: 'left' };
  return { x: rel * px, off: null };
}

export interface NearMark<T> {
  of: T;
  rel: number;
  dist: number;
}

/**
 * The nearest points within `range` tiles of the viewer, nearest first, at most `limit`, with their
 * bearings (the visor's supply-drop pips).
 */
export function nearMarks<T extends { at: readonly [number, number] }>(from: { x: number; z: number }, yaw: number, points: readonly T[], range: number, limit: number): NearMark<T>[] {
  const out: NearMark<T>[] = [];
  for (const p of points) {
    const b = bearingTo(from, { x: p.at[0], z: p.at[1] }, yaw);
    if (b.dist <= range) out.push({ of: p, rel: b.rel, dist: b.dist });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
}
