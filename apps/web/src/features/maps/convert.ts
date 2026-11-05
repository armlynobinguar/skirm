// A community map (skirm.map/v2 JSON) as the arena's V2Map: its own board, rules and names over an
// official map's look (palette, walls; `theme`). Registered maps are found by mapById, so the crew
// screen, the match screen and the arena draw them like the official ten.
import type { MapDefV2 } from '@skirm/engine/v2';
import { MAPS, registerMap, type Arena, type EffectClass, type V2Map } from '@/features/arena/world';

const TILE: Record<string, string | null> = {
  '#': 'wall',
  '.': null,
  ',': 'grass',
  T: 'tree',
  d: 'dirt',
  '~': 'water',
  L: 'lava',
  '^': 'fire',
  '*': 'item',
  E: 'exit',
  c: 'crate',
  B: 'block',
  V: 'valve',
};

/** Seconds per tick, for the pressure line. */
const TICK_S = 2;

export function communityToV2Map(def: MapDefV2, theme: string): V2Map {
  const base = MAPS.find((m) => m.id === theme) ?? MAPS[0]!;
  const h = def.rows.length;
  const w = def.rows[0]?.length ?? 0;
  const grid = def.rows.flatMap((r) => [...r].map((c) => TILE[c] ?? null));
  const mid = (w - 1) / 2;
  const items = grid.filter((t) => t === 'item').length;
  const ev = Object.fromEntries(def.hazards.map((hz) => [hz.kind, hz.every]));
  const cap = def.hazards.reduce((n, hz) => Math.max(n, hz.cap), 0);
  const A: Arena & Record<string, unknown> = {
    w,
    h,
    grid,
    starts: def.starts,
    exit: def.exit,
    n: def.goal,
    valves: def.switches.map((s) => ({ pos: s.at, name: s.name, kind: s.kind, lanes: s.lanes })),
    drops: def.drops.map((d) => [d.at[0], d.at[1], d.tick] as [number, number, number]),
    fog: def.fog,
    steal: def.steal,
    night: def.night,
    spec: {
      size: [w, h],
      band: Math.max(1, Math.floor(mid / 4)),
      routes: 1,
      cont: 0,
      valves: def.switches.length,
      drops: def.drops.map((d) => d.tick),
      own: Math.floor(items / 2),
      fog: def.fog,
      steal: def.steal,
      night: def.night,
    },
    center: def.exit,
    contested: [],
    origin: {},
    xl: true,
  };
  return {
    ...base,
    id: def.id,
    code: def.code,
    name: def.name,
    region: def.region,
    diff: def.difficulty,
    label: 'Community',
    blurb: def.blurb,
    item: def.item,
    exitN: def.deliverTo,
    verbs: def.verbs.map((v) => [v.name, v.effect as EffectClass]),
    ev,
    cap,
    pressure: def.hazards.length ? def.hazards.map((hz) => `${hz.kind} spreads every ${hz.every * TICK_S} s`).join(', ') : 'No hazard',
    // Height steps belong to the theme's own board.
    ...({ elev: null } as object),
    A,
  } as V2Map;
}

/** Converts and registers a community map so mapById finds it. */
export function registerCommunityMap(def: MapDefV2, theme: string): V2Map {
  const m = communityToV2Map(def, theme);
  registerMap(m);
  return m;
}
