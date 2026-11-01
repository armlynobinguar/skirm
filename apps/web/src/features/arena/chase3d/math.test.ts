import { describe, expect, it } from 'vitest';
import { DIST_MAX, DIST_MIN, angDiff, chaseRig, ease, headingYaw, segDist, softFog, stepAgentFade, stepSoftFog, wallBlocks, wheelDist } from './math';

describe('chase cam maths', () => {
  it('measures distance to a segment, clamped to its ends', () => {
    expect(segDist(1, 1, 0, 0, 2, 0)).toBeCloseTo(1);
    expect(segDist(-3, 0, 0, 0, 2, 0)).toBeCloseTo(3);
    expect(segDist(5, 4, 0, 0, 2, 0)).toBeCloseTo(5);
    // A zero-length segment is a point.
    expect(segDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it('turns the short way round', () => {
    expect(angDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(angDiff(Math.PI * 2 - 0.1, 0.1)).toBeCloseTo(0.2);
    expect(Math.abs(angDiff(-3, 3))).toBeLessThanOrEqual(Math.PI);
  });

  it('eases out and clamps', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });

  it('steers by the last steps, the newest weighted most', () => {
    expect(headingYaw([])).toBeNull();
    // Facing +x (yaw π/2), then one sidestep down does not swing the view all the way round.
    const yaw = headingYaw([
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ])!;
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 2);
    expect(headingYaw([[0, 1]])).toBeCloseTo(0);
    // Steps that cancel out leave the heading where it was.
    expect(
      headingYaw([
        [2, 0],
        [-1, 0],
      ]),
    ).toBeNull();
  });

  it('sits behind the agent, up and to the right, looking past it', () => {
    // Walking +z (yaw 0): camera behind on -z, raised, offset to the right (-x), looking ahead on +z.
    const r = chaseRig({ x: 10, z: 5 }, 0, 5);
    expect(r.pos.z).toBeCloseTo(0);
    expect(r.pos.y).toBeCloseTo(5 * 0.66 + 0.4);
    expect(r.pos.x).toBeCloseTo(9.5);
    expect(r.look.z).toBeCloseTo(8.2);
    expect(r.look.y).toBeCloseTo(0.4);
    // Walking +x (yaw π/2): behind is -x.
    const e = chaseRig({ x: 10, z: 5 }, Math.PI / 2, 5);
    expect(e.pos.x).toBeCloseTo(5);
    expect(e.look.x).toBeCloseTo(13.2);
  });

  it('zooms one notch per wheel step within its limits', () => {
    expect(wheelDist(5, -100)).toBeCloseTo(4.5);
    expect(wheelDist(5, 100)).toBeCloseTo(5.5);
    expect(wheelDist(DIST_MIN, -100)).toBe(DIST_MIN);
    expect(wheelDist(DIST_MAX, 100)).toBe(DIST_MAX);
  });

  it('cuts away walls between the camera and the agent, not the one it stands by', () => {
    const cam = { x: 0, z: 0 };
    const focus = { x: 6, z: 0 };
    expect(wallBlocks(3, 0, cam, focus)).toBe(true);
    expect(wallBlocks(3, 2, cam, focus)).toBe(false);
    expect(wallBlocks(6, 0.2, cam, focus)).toBe(false);
  });

  it('blurs sight into soft fog, eases it in and keeps explored tiles dimly lit', () => {
    const W = 9;
    const H = 3;
    const F = softFog(W, H);
    const sight = Array.from({ length: W * H }, (_, i) => i % W < 3);
    let light = stepSoftFog(F, sight, 0.016);
    // Eased: one short step only has the dim explored light.
    expect(light[W + 0]).toBeLessThan(0.4);
    for (let i = 0; i < 200; i++) light = stepSoftFog(F, sight, 0.05);
    expect(light[W + 0]).toBeCloseTo(1, 1);
    // Far from sight: never seen.
    expect(light[W + 8]).toBeCloseTo(0.1, 2);
    // The edge of sight falls off softly.
    expect(light[W + 3]).toBeGreaterThan(0.1);
    expect(light[W + 3]).toBeLessThan(light[W + 1]!);
    // Sight moves away: the old tiles stay dimly lit, above never-seen.
    const moved = Array.from({ length: W * H }, (_, i) => i % W > 5);
    for (let i = 0; i < 200; i++) light = stepSoftFog(F, moved, 0.05);
    expect(light[W + 0]).toBeCloseTo(0.1 + 0.9 * 0.26, 2);
    expect(light[W + 8]).toBeCloseTo(1, 1);
  });

  it('fades rivals out off sight and back in, never the watching crew', () => {
    const agents = [
      { id: 'a', team: 'A' as const, x: 0, y: 0 },
      { id: 'b', team: 'B' as const, x: 2, y: 0 },
    ];
    const seen = (i: number) => i < 1;
    const fade: Record<string, number> = {};
    stepAgentFade(fade, agents, seen, 'A', 3, 0.016);
    // First sight snaps.
    expect(fade).toEqual({ a: 1, b: 0 });
    agents[1]!.x = 0;
    stepAgentFade(fade, agents, seen, 'A', 3, 0.05);
    expect(fade.b).toBeGreaterThan(0);
    expect(fade.b).toBeLessThan(1);
    for (let i = 0; i < 100; i++) stepAgentFade(fade, agents, seen, 'A', 3, 0.05);
    expect(fade.b).toBeCloseTo(1);
    // No fog: everyone shows.
    expect(stepAgentFade({}, agents, null, 'A', 3, 0.05)).toEqual({ a: 1, b: 1 });
  });
});
