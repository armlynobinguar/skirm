import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AgentAvatar,
  CHEER_S,
  ROLE_LOOKS,
  dressLook,
  genericLook,
  isoPolys,
  lookFor,
  lookParts,
  lookTop,
  poseAt,
  poseKind,
} from '../src';
import { paintsBefore } from '../src/looks';

afterEach(cleanup);

describe('role looks', () => {
  it('has a distinct look for every role, each adding its own parts over the body', () => {
    const roles = [
      'Builder',
      'Digger',
      'Firefighter',
      'Scout',
      'Runner',
      'Hauler',
      'Medic',
      'Engineer',
      'Saboteur',
      'Courier',
    ];
    for (const r of roles) expect(ROLE_LOOKS[r], r).toBeDefined();
    const sig = roles.map((r) => JSON.stringify(ROLE_LOOKS[r]!.parts));
    expect(new Set(sig).size).toBe(roles.length);
    for (const r of roles) expect(ROLE_LOOKS[r]!.parts.length).toBeGreaterThan(1);
  });

  it('gives Haulers three carry slots and a count, everyone else two', () => {
    expect(lookFor('Hauler').carry).toBe(3);
    expect(lookFor('Hauler').count).toBe(true);
    expect(lookFor('Runner').carry).toBe(2);
    expect(lookFor('Runner').count).toBeFalsy();
  });

  it('reads roles in any case and falls back to a generic look for unknown or missing roles', () => {
    expect(lookFor('builder')).toBe(ROLE_LOOKS.Builder);
    expect(lookFor('DIGGER')).toBe(ROLE_LOOKS.Digger);
    const a = lookFor('Alchemist');
    expect(a).toBe(lookFor('alchemist'));
    expect(a).toBe(genericLook('Alchemist'));
    expect(a.verb).toBe('none');
    expect(a.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(lookFor('Alchemist').accent).not.toBe(lookFor('Necromancer').accent);
    expect(lookFor(undefined)).toBe(genericLook());
    expect(lookFor('')).toBe(genericLook());
  });

  it('builds the figure as boots, torso, head and visor plus the role parts', () => {
    const parts = lookParts(ROLE_LOOKS.Scout!);
    expect(parts.filter((q) => q.group === 'footL' || q.group === 'footR')).toHaveLength(2);
    expect(parts.some((q) => q.fill === 'body' && q.group === 'body')).toBe(true);
    expect(parts.some((q) => q.group === 'tip')).toBe(true);
    // The antenna lifts the carry height over the plain figure's.
    expect(lookTop(ROLE_LOOKS.Scout!)).toBeGreaterThan(lookTop(genericLook()));
  });

  it('projects to isometric polygons: three faces a box, two for a band, in the agent colours', () => {
    const look = ROLE_LOOKS.Runner!;
    const parts = lookParts(look);
    const bands = parts.filter((q) => q.band).length;
    const polys = isoPolys(look, { body: '#34e0c8', head: '#ece8e1' }, 1);
    expect(polys).toHaveLength(parts.length * 3 - bands);
    expect(polys.every((q) => q.pts.length === 8)).toBe(true);
    // The torso's top face is the body colour itself.
    expect(polys.some((q) => q.fill === 'rgb(52,224,200)')).toBe(true);
    // Facing the other way mirrors the figure.
    const b = isoPolys(look, { body: '#34e0c8', head: '#ece8e1' }, -1);
    expect(b).toHaveLength(polys.length);
    expect(b.map((q) => q.pts[0])).not.toEqual(polys.map((q) => q.pts[0]));
  });

  it('paints lower and further boxes first, and a wrapped band over what it wraps', () => {
    const box = (tx: number, ty: number, y0: number, h: number, hx = 0.1, hy = 0.1) => ({
      tx,
      ty,
      hx,
      hy,
      y0,
      h,
      key: tx + ty,
    });
    expect(paintsBefore(box(0, 0, 0, 0.2), box(0, 0, 0.2, 0.3))).toBe(true);
    expect(paintsBefore(box(0.5, 0, 0, 0.3), box(0, 0, 0, 0.3))).toBe(false);
    expect(paintsBefore(box(0, -0.5, 0, 0.3), box(0, 0, 0, 0.3))).toBe(true);
    const torso = box(0, 0, 0.2, 0.3, 0.2, 0.2);
    const belt = box(0, 0, 0.22, 0.05, 0.21, 0.21);
    expect(paintsBefore(torso, belt)).toBe(true);
    expect(paintsBefore(belt, torso)).toBe(false);
  });
});

describe('poses', () => {
  it('picks the pose by priority: out, down, stun, cheer, act, walk, carry, idle', () => {
    expect(poseKind({ out: true, down: true })).toBe('out');
    expect(poseKind({ down: true, stun: true, act: 'add_solid' })).toBe('down');
    expect(poseKind({ stun: true, cheer: true })).toBe('stun');
    expect(poseKind({ cheer: true, act: 'add_solid', moving: true })).toBe('cheer');
    expect(poseKind({ act: 'remove_solid', moving: true })).toBe('act');
    expect(poseKind({ moving: true, carrying: 2 })).toBe('walk');
    expect(poseKind({ carrying: 1 })).toBe('carry');
    expect(poseKind({})).toBe('idle');
  });

  it('tips a knocked-down agent over as the frame plays, and fully at once with reduced motion', () => {
    const look = ROLE_LOOKS.Digger!;
    const start = poseAt('down', look, { time: 0, age: 0 });
    const end = poseAt('down', look, { time: 0, age: 2 });
    expect(start.tilt).toBe(0);
    expect(end.tilt).toBeGreaterThan(1.2);
    expect(poseAt('down', look, { time: 0, age: 0, still: true }).tilt).toBe(end.tilt);
  });

  it('celebrates once: a hop with arms up, then back to idle', () => {
    const look = ROLE_LOOKS.Hauler!;
    const mid = poseAt('cheer', look, { time: 3, age: CHEER_S / 4 });
    expect(mid.lift).toBeGreaterThan(0.1);
    expect(mid.off.hand?.[1]).toBeGreaterThan(0.2);
    const after = poseAt('cheer', look, { time: 3, age: CHEER_S + 0.5 });
    expect(after.kind).toBe('idle');
    expect(after.fx).toBe(0);
  });

  it('keeps every pose fixed under reduced motion (no bob, wobble or hops)', () => {
    for (const kind of ['idle', 'walk', 'carry', 'act', 'stun', 'cheer', 'down'] as const)
      for (const role of Object.keys(ROLE_LOOKS)) {
        const look = ROLE_LOOKS[role]!;
        const a = poseAt(kind, look, { time: 0.3, age: 0.1, walk: 0.2, still: true });
        const b = poseAt(kind, look, { time: 7.9, age: 0.9, walk: 0.7, still: true });
        expect(b, `${role} ${kind}`).toEqual(a);
        expect(a.lift).toBe(0);
      }
  });

  it('animates each verb its own way', () => {
    const at = (r: string) => poseAt('act', ROLE_LOOKS[r]!, { time: 0.2, age: 0.2 });
    expect(at('Scout').tipScale).toBeGreaterThan(1);
    expect(at('Digger').off.hand?.[1]).toBeGreaterThan(0);
    expect(at('Firefighter').off.hand?.[2]).toBeGreaterThan(0);
  });

  it('swings the feet while walking, longer for Runners', () => {
    const w = poseAt('walk', ROLE_LOOKS.Builder!, { time: 0, age: 0, walk: 0.25 });
    const r = poseAt('walk', ROLE_LOOKS.Runner!, { time: 0, age: 0, walk: 1 / 6 });
    expect(w.off.footL?.[2]).toBeCloseTo(-(w.off.footR?.[2] ?? 0));
    expect(Math.abs(r.off.footL![2])).toBeGreaterThan(Math.abs(w.off.footL![2]) * 1.2);
    expect(r.lean).toBeGreaterThan(w.lean);
  });
});

describe('AgentAvatar with a role', () => {
  it('draws the role figure (polygons) instead of the round glyph', () => {
    const { container } = render(<AgentAvatar size={32} label="Rook" role="Scout" crew="a" />);
    expect(screen.getByRole('img', { name: 'Rook, Scout, crew A' })).toBeTruthy();
    expect(container.querySelectorAll('polygon').length).toBe(
      isoPolys(lookFor('Scout'), { body: '#34e0c8', head: '#ece8e1' }, 1).length,
    );
    expect(container.querySelector('[data-role="Scout"]')).toBeTruthy();
  });

  it('keeps the glyph without a role, and draws unknown roles with the generic look', () => {
    const { container } = render(<AgentAvatar size={32} label="Ada" />);
    expect(container.querySelectorAll('polygon')).toHaveLength(0);
    cleanup();
    const r = render(<AgentAvatar size={32} label="X" role="Alchemist" body="#ffb547" />);
    expect(r.container.querySelectorAll('polygon').length).toBeGreaterThan(10);
  });
});

describe('dressed looks', () => {
  const dress = { hair: 'ponytail', hairColor: '#b8432f', pants: '#2e4a3a', build: 'regular', headgear: 'role' } as const;

  it('keeps the role hat with role headgear and swaps it otherwise', () => {
    const builder = lookFor('Builder');
    const own = dressLook(builder, dress);
    expect(own.parts.some((q) => q.fill === '#fff1a8')).toBe(true);
    const capped = dressLook(builder, { ...dress, headgear: 'cap' });
    expect(capped.parts.some((q) => q.fill === '#fff1a8')).toBe(false);
    // The cap is in the role's accent; the hammer stays in hand.
    expect(capped.parts.some((q) => q.fill === builder.accent)).toBe(true);
    expect(capped.parts.some((q) => q.group === 'hand')).toBe(true);
  });

  it('drops the antenna tip with other headgear', () => {
    const scout = lookFor('Scout');
    expect(scout.parts.some((q) => q.group === 'tip')).toBe(true);
    expect(dressLook(scout, { ...dress, headgear: 'none' }).parts.some((q) => q.group === 'tip')).toBe(false);
  });

  it('scales the torso by build and colours the legs', () => {
    const base = lookFor('Runner');
    const slim = dressLook(base, { ...dress, build: 'slim' });
    const sturdy = dressLook(base, { ...dress, build: 'sturdy' });
    expect(slim.torso[0]).toBeLessThan(base.torso[0]);
    expect(sturdy.torso[0]).toBeGreaterThan(base.torso[0]);
    expect(lookParts(sturdy).filter((q) => q.fill === '#2e4a3a')).toHaveLength(2);
  });

  it('hides the hair top under a hat but keeps a ponytail', () => {
    const top = (l: ReturnType<typeof lookFor>) => l.parts.filter((q) => q.fill === '#b8432f' && q.at[1] >= 0.76);
    const tail = (l: ReturnType<typeof lookFor>) => l.parts.filter((q) => q.fill === '#b8432f' && q.at[2] < -0.2);
    const bare = dressLook(lookFor('Medic'), { ...dress, headgear: 'none' });
    const beanie = dressLook(lookFor('Medic'), { ...dress, headgear: 'beanie' });
    expect(top(bare).length).toBeGreaterThan(0);
    expect(top(beanie)).toHaveLength(0);
    expect(tail(beanie)).toHaveLength(1);
    expect(dressLook(lookFor('Medic'), { ...dress, hair: 'none', headgear: 'none' }).parts.some((q) => q.fill === '#b8432f')).toBe(false);
  });

  it('is cached per look and dress', () => {
    const l = lookFor('Builder');
    expect(dressLook(l, { ...dress })).toBe(dressLook(l, { ...dress }));
    expect(isoPolys(dressLook(l, dress), { body: '#e2574c', head: '#d9a477', team: '#34e0c8' }, 1).length).toBeGreaterThan(0);
  });
});
