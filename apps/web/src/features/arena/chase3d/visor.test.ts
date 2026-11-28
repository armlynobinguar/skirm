import { describe, expect, it } from 'vitest';
import { PITCH_MAX, STICK_DEAD, STICK_TURN, VISOR_EYE, bearingTo, dragPitch, headingDeg, stickOf, stickTurn, tapeCells, tapeMark, tapeShift, visorRig, wrap360 } from './visor';

describe('visor rig', () => {
  it('puts the eye at the agent, at eye height, looking along its yaw', () => {
    const r = visorRig({ x: 4, z: 2 }, 0);
    expect(r.pos.y).toBe(VISOR_EYE);
    expect(r.pos.x).toBeCloseTo(4);
    expect(r.pos.z).toBeGreaterThan(2);
    expect(r.look.z - r.pos.z).toBeCloseTo(1);
    expect(r.look.y).toBeCloseTo(VISOR_EYE);
    const east = visorRig({ x: 0, z: 0 }, Math.PI / 2);
    expect(east.look.x - east.pos.x).toBeCloseTo(1);
    expect(east.look.z - east.pos.z).toBeCloseTo(0);
  });

  it('tilts with pitch, clamped', () => {
    const up = visorRig({ x: 0, z: 0 }, 0, 0.5);
    expect(up.look.y).toBeGreaterThan(VISOR_EYE);
    const far = visorRig({ x: 0, z: 0 }, 0, 10);
    expect(far.look.y - VISOR_EYE).toBeCloseTo(Math.sin(PITCH_MAX));
  });
});

describe('compass', () => {
  it('reads north towards row 0, east towards +x', () => {
    expect(headingDeg(0)).toBeCloseTo(180);
    expect(headingDeg(Math.PI / 2)).toBeCloseTo(90);
    expect(headingDeg(Math.PI)).toBeCloseTo(0);
    expect(headingDeg(-Math.PI / 2)).toBeCloseTo(270);
    expect(wrap360(-30)).toBe(330);
  });

  it('gives a bearing right of centre as positive', () => {
    // Facing south (+z): the camera's right is -x.
    expect(bearingTo({ x: 5, z: 5 }, { x: 5, z: 9 }, 0)).toEqual({ rel: 0, dist: 4 });
    expect(bearingTo({ x: 5, z: 5 }, { x: 2, z: 5 }, 0).rel).toBeCloseTo(90);
    expect(bearingTo({ x: 5, z: 5 }, { x: 8, z: 5 }, 0).rel).toBeCloseTo(-90);
    expect(bearingTo({ x: 5, z: 5 }, { x: 5, z: 1 }, 0).rel).toBeCloseTo(180);
    expect(bearingTo({ x: 5, z: 5 }, { x: 5, z: 5 }, 1)).toEqual({ rel: 0, dist: 0 });
  });

  it('turning right raises the heading and moves a marker left', () => {
    const a = headingDeg(0);
    const b = headingDeg(-0.2);
    expect(b).toBeGreaterThan(a);
    const m0 = bearingTo({ x: 0, z: 0 }, { x: 0, z: 5 }, 0).rel;
    const m1 = bearingTo({ x: 0, z: 0 }, { x: 0, z: 5 }, -0.2).rel;
    expect(m1).toBeLessThan(m0);
  });

  it('lays one turn of cells with the cardinals marked', () => {
    const cells = tapeCells();
    expect(cells).toHaveLength(24);
    expect(cells.filter((c) => c.cardinal).map((c) => c.label)).toEqual(['N', 'E', 'S', 'W']);
    expect(cells[3]!.label).toBe('45');
    expect(cells[1]!.label).toBe('·');
  });

  it('shifts the strip so the heading sits under the middle', () => {
    const cell = 30;
    const W = 300;
    // Cell k of the strip is centred at k * cell + cell / 2; the middle turn starts at cell 24.
    for (const h of [0, 90, 200, 359]) {
      const shift = tapeShift(h, cell, W);
      const centreOfHeading = shift + ((360 + h) / 15) * cell + cell / 2;
      expect(centreOfHeading).toBeCloseTo(W / 2);
    }
  });

  it('clamps a marker to the tape and says which way to turn', () => {
    expect(tapeMark(10, 30, 300)).toEqual({ x: 20, off: null });
    expect(tapeMark(120, 30, 300)).toEqual({ x: 150, off: 'right' });
    expect(tapeMark(-120, 30, 300)).toEqual({ x: -150, off: 'left' });
  });
});

describe('look stick (phones)', () => {
  it('rests in the dead zone and clamps to the rim', () => {
    expect(stickOf(0, 0, 50)).toEqual({ x: 0, y: 0 });
    expect(stickOf(50 * STICK_DEAD * 0.9, 0, 50)).toEqual({ x: 0, y: 0 });
    const rim = stickOf(500, 0, 50);
    expect(rim.x).toBeCloseTo(1);
    expect(rim.y).toBeCloseTo(0);
    expect(stickOf(10, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('reads up as up (screen y grows down) and answers small pushes finely', () => {
    expect(stickOf(0, -50, 50).y).toBeCloseTo(1);
    const half = stickOf(25, 0, 50).x;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.5);
    const diag = stickOf(100, 100, 50);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
  });

  it('turns right for a push right and looks up for a push up, at the stick rate', () => {
    const t = stickTurn({ x: 1, y: 0 }, 0.5);
    expect(t.look).toBeCloseTo(-STICK_TURN * 0.5);
    expect(t.pitch).toBe(0);
    expect(stickTurn({ x: 0, y: 1 }, 1).pitch).toBeCloseTo(STICK_TURN / 2);
  });

  it('tilts with a vertical drag, clamped', () => {
    expect(dragPitch(0, -100)).toBeCloseTo(0.6);
    expect(dragPitch(0, 100)).toBeCloseTo(-0.6);
    expect(dragPitch(0, -10_000)).toBe(PITCH_MAX);
  });
});
