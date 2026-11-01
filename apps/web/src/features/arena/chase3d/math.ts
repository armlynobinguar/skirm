// The chase cam's plain maths (the prototype's segDist, angDiff, fogLight, agentFade and camera
// rig), kept free of `three` so it is unit-tested without WebGL and costs the main bundle nothing.

/** Distance from point p to the segment a→b on the ground plane. */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** The signed shortest turn from angle a to angle b, in (-π, π]. */
export function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Cubic ease-out on 0..1 (the prototype's ease). */
export function ease(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

/** How many recent steps steer the camera's heading. */
export const HEADING_STEPS = 4;

/**
 * The heading the camera swings to: the watched agent's last few steps, the newest weighted most,
 * so one sidestep in a corridor does not spin the view. Null when the steps cancel out.
 */
export function headingYaw(steps: readonly (readonly [number, number])[]): number | null {
  let sx = 0;
  let sz = 0;
  steps.forEach(([dx, dz], i) => {
    sx += dx * (i + 1);
    sz += dz * (i + 1);
  });
  return sx || sz ? Math.atan2(sx, sz) : null;
}

export interface ChaseRig {
  /** Where the camera wants to be. */
  pos: { x: number; y: number; z: number };
  /** The point it looks at: past the agent, so the way ahead fills the view. */
  look: { x: number; y: number; z: number };
}

/** Closest and farthest the wheel moves the camera. */
export const DIST_MIN = 2.4;
export const DIST_MAX = 9;
export const DIST_START = 5.6;

/** Behind the agent along `yaw`, a little to the right and up, looking past it. */
export function chaseRig(focus: { x: number; z: number }, yaw: number, dist: number): ChaseRig {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  return {
    pos: { x: focus.x - fx * dist + rx * 0.5, y: dist * 0.66 + 0.4, z: focus.z - fz * dist + rz * 0.5 },
    look: { x: focus.x + fx * 3.2 + rx * 0.15, y: 0.4, z: focus.z + fz * 3.2 + rz * 0.15 },
  };
}

/** One wheel notch in (deltaY < 0) or out, clamped. */
export function wheelDist(dist: number, deltaY: number): number {
  return Math.max(DIST_MIN, Math.min(DIST_MAX, dist * (deltaY < 0 ? 0.9 : 1.1)));
}

/** A wall tile drops to a cutaway when it stands between the camera and the agent (not under it). */
export function wallBlocks(wx: number, wz: number, cam: { x: number; z: number }, focus: { x: number; z: number }): boolean {
  return segDist(wx, wz, cam.x, cam.z, focus.x, focus.z) < 0.95 && Math.hypot(wx - focus.x, wz - focus.z) > 0.4;
}

/** Frame-rate independent approach factor: move this share of the way per `dt` at `rate`. */
export function approach(dt: number, rate: number): number {
  return 1 - Math.exp(-dt * rate);
}

/**
 * Soft fog (the prototype's fogLight): the crew's sight blurred over a 5×5 kernel, eased in over
 * time, with explored tiles kept dimly lit. `light` is 0.1 (never seen) to 1 (in sight) per tile.
 */
export interface SoftFog {
  w: number;
  h: number;
  /** Eased light. */
  L: Float32Array;
  /** Target light from the current sight. */
  T: Float32Array;
  /** Highest light each tile has had: explored tiles stay dimly lit. */
  E: Float32Array;
  /** What the renderer reads. */
  light: Float32Array;
  /** The sight array the target was built from. */
  from: readonly unknown[] | null;
}

export function softFog(w: number, h: number): SoftFog {
  const n = w * h;
  return { w, h, L: new Float32Array(n), T: new Float32Array(n), E: new Float32Array(n), light: new Float32Array(n), from: null };
}

const KERNEL = [1, 4, 6, 4, 1];

/**
 * Steps the soft fog `dt` seconds towards `sight`: true/1 seen, false/0 unseen, or a light value
 * from 0 to 1 per tile (an arena that already ships soft light).
 */
export function stepSoftFog(F: SoftFog, sight: readonly (boolean | number)[], dt: number): Float32Array {
  const { w: W, h: H } = F;
  if (F.from !== sight) {
    F.from = sight;
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += KERNEL[k + 2]! * Number(sight[y * W + Math.min(W - 1, Math.max(0, x + k))] ?? 0);
        tmp[y * W + x] = s / 16;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += KERNEL[k + 2]! * tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x]!;
        const t = Math.min(1, (s / 16) * 1.35);
        F.T[y * W + x] = t * t * (3 - 2 * t);
      }
    for (let i = 0; i < W * H; i++) if (F.T[i]! > F.E[i]!) F.E[i] = F.T[i]!;
  }
  const k = approach(dt, 3.2);
  for (let i = 0; i < W * H; i++) {
    F.L[i] = F.L[i]! + (F.T[i]! - F.L[i]!) * k;
    F.light[i] = 0.1 + 0.9 * Math.max(F.L[i]!, F.E[i]! * 0.26);
  }
  return F.light;
}

/**
 * Rivals fade out on tiles the watching crew cannot see and back in when sighted (the prototype's
 * agentFade). Eases `fade` in place and returns it.
 */
export function stepAgentFade(
  fade: Record<string, number>,
  agents: readonly { id: string; team: 'A' | 'B'; x: number; y: number }[],
  seen: ((i: number) => boolean) | null,
  team: 'A' | 'B',
  w: number,
  dt: number,
): Record<string, number> {
  const k = approach(dt, 6);
  for (const a of agents) {
    const t = seen && a.team !== team && !seen(a.y * w + a.x) ? 0 : 1;
    const f = fade[a.id];
    fade[a.id] = f == null ? t : f + (t - f) * k;
  }
  return fade;
}
