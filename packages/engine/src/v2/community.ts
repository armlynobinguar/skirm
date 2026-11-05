// Community maps: v2 maps players draw in the web map editor and publish for practice and casual
// play (never ranked). A community map is a plain skirm.map/v2 definition, so the engine plays it
// like an official one; it must pass parseMapV2 plus the stricter rules the official ten already
// keep: a walled border, a fully mirrored layout (tiles, starts, switch lanes), the delivery point,
// switches and supply drops on the centre column, a source tile for every spreading hazard, and
// enough goal items to reach the goal. validateCommunityMap reports every problem it finds (with the
// tile when there is one) so the editor can show them inline; the server runs it again on publish.
import { DIFF_MODS } from './difficulty';
import { EFFECT_CLASSES, MapError, parseMapV2, type HazardKind, type MapDefV2, type ParsedMap } from './map';

export const COMMUNITY_MAP_LIMITS = {
  minW: 11,
  maxW: 55,
  minH: 9,
  maxH: 25,
  maxStarts: 3,
  maxSwitches: 3,
  maxDrops: 3,
  maxVerbs: 6,
  maxGoal: 10,
  maxBlockSupply: 5,
  /** Hazard spread interval and wave cap bounds. */
  every: [1, 20] as const,
  cap: [1, 10] as const,
  /** Characters of each player-written text field. */
  text: { name: 40, region: 40, blurb: 240, item: 24, deliverTo: 24, verb: 32, switch: 32 },
} as const;

/** Board sizes the editor offers (the official maps' sizes, by difficulty). */
export const MAP_SIZE_PRESETS: readonly { id: string; label: string; w: number; h: number }[] = [
  { id: 'small', label: 'Small', w: 31, h: 13 },
  { id: 'medium', label: 'Medium', w: 35, h: 15 },
  { id: 'standard', label: 'Standard', w: 41, h: 19 },
  { id: 'large', label: 'Large', w: 47, h: 21 },
  { id: 'huge', label: 'Huge', w: 55, h: 25 },
];

/** Community map ids: `cmp_` + ULID (the server assigns them). */
export const COMMUNITY_MAP_ID_RE = /^cmp_[0-9A-HJKMNP-TV-Z]{26}$/;

export function isCommunityMapId(id: string): boolean {
  return COMMUNITY_MAP_ID_RE.test(id);
}

/** One problem with a map, at a tile when it is about one. */
export interface MapIssue {
  message: string;
  at?: [number, number];
}

export type CommunityMapCheck = { ok: true; map: ParsedMap } | { ok: false; issues: MapIssue[] };

const HAZARD_TILE: Record<HazardKind, string> = { water: '~', fire: '^', lava: 'L' };
const SWITCH_KINDS = ['water', 'fire', 'dirt'] as const;
/** Ticks a supply drop may land on: after the start, before the shortest clock. */
const DROP_TICKS: readonly [number, number] = [1, Math.min(...Object.values(DIFF_MODS).map((d) => d.ticks)) - 1];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]);
const chars = (s: string) => [...s].length;

/**
 * Every problem with a community map draft, or the parsed map when there is none. `def` is
 * untrusted (a request body), so its shape is checked before anything reads it.
 */
export function validateCommunityMap(def: unknown): CommunityMapCheck {
  const issues: MapIssue[] = [];
  const bad = (message: string, at?: [number, number]) => void issues.push(at ? { message, at } : { message });
  const L = COMMUNITY_MAP_LIMITS;
  if (!isObj(def)) return { ok: false, issues: [{ message: 'the map must be an object' }] };

  // Shape first: parseMapV2 trusts its input's types.
  if (def.schema !== 'skirm.map/v2') bad('schema must be skirm.map/v2');
  for (const k of ['id', 'code', 'name', 'region', 'label', 'blurb', 'item', 'deliverTo'] as const)
    if (typeof def[k] !== 'string') bad(`${k} must be text`);
  if (!Array.isArray(def.rows) || !def.rows.length || !def.rows.every((r) => typeof r === 'string')) bad('rows must be a list of text rows');
  if (!isObj(def.starts) || !Array.isArray(def.starts.A) || !Array.isArray(def.starts.B) || ![...def.starts.A, ...def.starts.B].every(isPoint))
    bad('starts must list [x, y] tiles for crews A and B');
  if (!isPoint(def.exit)) bad('exit must be an [x, y] tile');
  if (!isInt(def.goal)) bad('goal must be a whole number');
  if (!isInt(def.difficulty) || def.difficulty < 1 || def.difficulty > 5) bad('difficulty must be 1 to 5');
  if (!isInt(def.blockSupply)) bad('blockSupply must be a whole number');
  for (const k of ['fog', 'steal', 'night'] as const) if (typeof def[k] !== 'boolean') bad(`${k} must be true or false`);
  if (!Array.isArray(def.verbs) || !def.verbs.every((v) => isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.effect === 'string'))
    bad('verbs must be a list of {id, name, effect}');
  if (!Array.isArray(def.hazards) || !def.hazards.every((h) => isObj(h) && typeof h.kind === 'string' && isInt(h.every) && isInt(h.cap)))
    bad('hazards must be a list of {kind, every, cap}');
  if (
    !Array.isArray(def.switches) ||
    !def.switches.every(
      (s) =>
        isObj(s) &&
        isPoint(s.at) &&
        typeof s.name === 'string' &&
        typeof s.kind === 'string' &&
        isObj(s.lanes) &&
        Array.isArray(s.lanes.A) &&
        Array.isArray(s.lanes.B) &&
        [...s.lanes.A, ...s.lanes.B].every(isInt),
    )
  )
    bad('switches must be a list of {at, name, kind, lanes: {A, B}}');
  if (!Array.isArray(def.drops) || !def.drops.every((d) => isObj(d) && isPoint(d.at) && isInt(d.tick))) bad('drops must be a list of {at, tick}');
  if (issues.length) return { ok: false, issues };

  const m = def as unknown as MapDefV2;
  const h = m.rows.length;
  const w = m.rows[0]!.length;
  const at = (x: number, y: number) => m.rows[y]?.[x];
  const mid = (w - 1) / 2;

  // Text: present and short. The server also runs it through the speech filter.
  const text = (label: string, v: string, max: number, min = 1) => {
    const n = chars(v.trim());
    if (n < min) bad(`${label} is empty`);
    else if (n > max) bad(`${label}: at most ${max} characters`);
  };
  text('name', m.name, L.text.name);
  text('region', m.region, L.text.region);
  text('blurb', m.blurb, L.text.blurb, 0);
  text('item', m.item, L.text.item);
  text('delivery point', m.deliverTo, L.text.deliverTo);

  // Size and border.
  if (w < L.minW || w > L.maxW || h < L.minH || h > L.maxH) bad(`the board must be ${L.minW} to ${L.maxW} wide and ${L.minH} to ${L.maxH} tall`);
  if (m.rows.some((r) => r.length !== w)) bad('rows differ in length');
  else {
    for (let x = 0; x < w; x++) {
      if (at(x, 0) !== '#') bad('the border must be wall', [x, 0]);
      if (at(x, h - 1) !== '#') bad('the border must be wall', [x, h - 1]);
    }
    for (let y = 1; y < h - 1; y++) {
      if (at(0, y) !== '#') bad('the border must be wall', [0, y]);
      if (at(w - 1, y) !== '#') bad('the border must be wall', [w - 1, y]);
    }
    // Mirrored across the centre column, tile for tile.
    let asym = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < mid; x++)
        if (at(x, y) !== at(w - 1 - x, y) && asym++ < 8) bad('the two halves differ here (use the mirror tool)', [w - 1 - x, y]);
    if (asym > 8) bad(`${asym - 8} more tiles differ between the halves`);
    const exits: [number, number][] = [];
    m.rows.forEach((r, y) => [...r].forEach((c, x) => c === 'E' && exits.push([x, y])));
    if (exits.length !== 1) bad(`place exactly one delivery point (found ${exits.length})`);
    for (const [x, y] of exits) if (x !== mid) bad('the delivery point must be on the centre column', [x, y]);
    if (exits.length === 1 && (exits[0]![0] !== m.exit[0] || exits[0]![1] !== m.exit[1])) bad('exit does not match the delivery point tile');
  }

  // Crews.
  if (m.starts.A.length > L.maxStarts || m.starts.B.length > L.maxStarts) bad(`at most ${L.maxStarts} starts per crew`);
  if (m.starts.A.length !== m.starts.B.length) bad('both crews need the same number of starts');
  const seen = new Set<string>();
  for (const [x, y] of [...m.starts.A, ...m.starts.B]) {
    if (seen.has(`${x},${y}`)) bad('two starts on one tile', [x, y]);
    seen.add(`${x},${y}`);
  }
  for (const [x, y] of m.starts.A) if (x >= mid) bad("crew A's starts must be on the left half", [x, y]);

  // Rules.
  if (m.goal < 1 || m.goal > L.maxGoal) bad(`goal must be 1 to ${L.maxGoal}`);
  if (m.blockSupply < 0 || m.blockSupply > L.maxBlockSupply) bad(`block supply must be 0 to ${L.maxBlockSupply}`);
  const items = m.rows.join('').split('').filter((c) => c === '*').length;
  if (items + m.drops.length < m.goal) bad(`the goal needs ${m.goal} items but the map has ${items} plus ${m.drops.length} supply drops`);

  if (!m.verbs.length) bad('add at least one themed verb');
  if (m.verbs.length > L.maxVerbs) bad(`at most ${L.maxVerbs} verbs`);
  for (const v of m.verbs) {
    if (!/^[a-z0-9_]{1,40}$/.test(v.id)) bad(`verb id ${JSON.stringify(v.id)}: lowercase letters, digits and _ only`);
    text(`verb ${v.id}`, v.name, L.text.verb);
    if (!EFFECT_CLASSES.includes(v.effect)) bad(`verb ${v.id}: unknown effect ${v.effect}`);
  }

  const kinds = new Set<string>();
  for (const hz of m.hazards) {
    if (!(hz.kind in HAZARD_TILE)) {
      bad(`unknown hazard ${hz.kind}`);
      continue;
    }
    if (kinds.has(hz.kind)) bad(`hazard ${hz.kind} listed twice`);
    kinds.add(hz.kind);
    if (hz.every < L.every[0] || hz.every > L.every[1]) bad(`${hz.kind} must spread every ${L.every[0]} to ${L.every[1]} ticks`);
    if (hz.cap < L.cap[0] || hz.cap > L.cap[1]) bad(`${hz.kind} must grow ${L.cap[0]} to ${L.cap[1]} waves`);
    if (!m.rows.some((r) => r.includes(HAZARD_TILE[hz.kind as HazardKind]))) bad(`${hz.kind} spreads but no ${hz.kind} tile is on the map`);
  }

  if (m.switches.length > L.maxSwitches) bad(`at most ${L.maxSwitches} switches`);
  const size = w * h;
  for (const s of m.switches) {
    text('switch name', s.name, L.text.switch);
    if (!(SWITCH_KINDS as readonly string[]).includes(s.kind)) bad(`switch kind must be water, fire or dirt`, s.at);
    if (s.at[0] !== mid) bad('a switch must be on the centre column', s.at);
    if (!s.lanes.A.length) bad('a switch needs a lane to flood', s.at);
    const inner = (j: number) => j >= 0 && j < size && j % w > 0 && j % w < w - 1 && j >= w && j < size - w;
    if (![...s.lanes.A, ...s.lanes.B].every(inner)) bad('switch lanes must be inside the map', s.at);
    else {
      const mirrored = s.lanes.A.length === s.lanes.B.length && s.lanes.A.every((j) => s.lanes.B.includes(Math.floor(j / w) * w + (w - 1 - (j % w))));
      if (!mirrored) bad("a switch's two lanes must mirror each other", s.at);
      if (s.lanes.A.some((j) => j % w >= mid)) bad("crew A's lane must be on the left half", s.at);
    }
  }

  if (m.drops.length > L.maxDrops) bad(`at most ${L.maxDrops} supply drops`);
  for (const d of m.drops) {
    if (d.at[0] !== mid) bad('a supply drop must land on the centre column', d.at);
    if (d.tick < DROP_TICKS[0] || d.tick > DROP_TICKS[1]) bad(`a supply drop lands on tick ${DROP_TICKS[0]} to ${DROP_TICKS[1]}`, d.at);
    if (at(d.at[0], d.at[1]) !== '.') bad('a supply drop must land on open floor', d.at);
  }

  // The engine's own checks last (they stop at the first problem).
  let map: ParsedMap | null = null;
  try {
    map = parseMapV2(m);
  } catch (e) {
    if (!(e instanceof MapError)) throw e;
    const msg = e.message.replace(/^[^:]*: /, '');
    if (!issues.some((i) => i.message === msg)) bad(msg);
  }
  return issues.length || !map ? { ok: false, issues: issues.length ? issues : [{ message: 'invalid map' }] } : { ok: true, map };
}

/** The tile mirrored across the centre column of a `w`-wide board. */
export const mirrorX = (w: number, x: number) => w - 1 - x;

/**
 * Copies one half of the board onto the other (the centre column stays), and makes crew B's starts
 * and every switch's B lane the mirror of crew A's. `from` is the half that is kept.
 */
export function mirrorMap(def: MapDefV2, from: 'left' | 'right' = 'left'): MapDefV2 {
  const w = def.rows[0]?.length ?? 0;
  const mid = (w - 1) / 2;
  const rows = def.rows.map((r) => {
    const c = [...r];
    for (let x = 0; x < mid; x++) {
      const m = mirrorX(w, x);
      if (from === 'left') c[m] = c[x]!;
      else c[x] = c[m]!;
    }
    return c.join('');
  });
  const flip = ([x, y]: [number, number]): [number, number] => [mirrorX(w, x), y];
  const leftOf = (p: [number, number]): [number, number] => (p[0] < mid ? p : flip(p));
  const startsA = (from === 'left' ? def.starts.A : def.starts.B.map(flip)).map(leftOf);
  const flipIdx = (j: number) => Math.floor(j / w) * w + mirrorX(w, j % w);
  return {
    ...def,
    rows,
    starts: { A: startsA, B: startsA.map(flip) },
    switches: def.switches.map((s) => {
      const laneA = from === 'left' ? s.lanes.A : s.lanes.B.map(flipIdx);
      return { ...s, lanes: { A: laneA, B: laneA.map(flipIdx) } };
    }),
  };
}

/** A blank walled board of `w` × `h` (w odd) with one start per crew and the delivery point in the middle. */
export function blankCommunityMap(w: number, h: number): MapDefV2 {
  const mid = (w - 1) / 2;
  const ey = Math.floor(h / 2);
  const rows = Array.from({ length: h }, (_, y) =>
    y === 0 || y === h - 1 ? '#'.repeat(w) : Array.from({ length: w }, (_, x) => (x === 0 || x === w - 1 ? '#' : x === mid && y === ey ? 'E' : '.')).join(''),
  );
  // One goal item on each side, mirrored.
  const iy = ey;
  rows[iy] = [...rows[iy]!].map((c, x) => (x === 3 || x === w - 4 ? '*' : c)).join('');
  return {
    schema: 'skirm.map/v2',
    id: 'draft',
    code: 'CM-00',
    name: 'Untitled map',
    region: 'Community',
    difficulty: 2,
    label: 'Community',
    blurb: '',
    item: 'Supply crate',
    deliverTo: 'Depot',
    goal: 1,
    rows,
    starts: { A: [[1, 1]], B: [[w - 2, 1]] },
    exit: [mid, ey],
    verbs: [
      { id: 'place_block', name: 'Place a block', effect: 'add_solid' },
      { id: 'clear_rubble', name: 'Clear rubble', effect: 'remove_solid' },
    ],
    hazards: [],
    switches: [],
    drops: [],
    blockSupply: 2,
    fog: false,
    steal: false,
    night: false,
  };
}

/** The hazards a map's tiles can spread (a source tile of the kind is on the board). */
export function hazardSources(def: Pick<MapDefV2, 'rows'>): HazardKind[] {
  return (Object.keys(HAZARD_TILE) as HazardKind[]).filter((k) => def.rows.some((r) => r.includes(HAZARD_TILE[k])));
}
