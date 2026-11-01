// Writes the ten v2 maps (spec/maps/v2/<id>.json) from the Skirm Arena Deck prototype's generator
// (apps/web/src/features/arena/proto/world.ts): the mirrored 2-crew arena, goal count, themed verbs
// with effect classes, hazards, switches, supply drops and the difficulty rules. The engine reads
// these files; rerun this script after changing the prototype's maps, then review the diff.
//
//   npx tsx scripts/export-v2-maps.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as proto from '../apps/web/src/features/arena/proto/world';

const OUT = join(import.meta.dirname, '..', 'spec', 'maps', 'v2');
const CHAR: Record<string, string> = {
  wall: '#', grass: ',', tree: 'T', dirt: 'd', water: '~', lava: 'L', fire: '^', item: '*', exit: 'E', crate: 'c', block: 'B', valve: 'V',
};
const name = (v: unknown) => (Array.isArray(v) ? (v[0] as string) : (v as string));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

mkdirSync(OUT, { recursive: true });
for (const m of proto.MAPS as any[]) {
  const A = m.A;
  const rows: string[] = [];
  for (let y = 0; y < A.h; y++) {
    let r = '';
    for (let x = 0; x < A.w; x++) {
      const t = A.grid[y * A.w + x];
      r += t === null ? '.' : CHAR[t] ?? '?';
    }
    rows.push(r);
  }
  if (rows.some((r) => r.includes('?'))) throw new Error(`${m.id}: unknown tile`);
  const def = {
    schema: 'skirm.map/v2',
    id: m.id,
    code: m.code,
    name: m.name,
    region: m.region,
    difficulty: m.diff,
    label: m.label,
    blurb: m.blurb,
    item: name(m.legend.supply),
    deliverTo: name(m.legend.exit),
    goal: A.n,
    rows,
    starts: { A: A.starts.A, B: A.starts.B },
    exit: A.exit,
    verbs: m.verbs.map(([text, effect]: [string, string]) => ({ id: slug(text), name: text, effect })),
    hazards: Object.entries(m.ev).map(([kind, every]) => ({ kind, every, cap: m.cap })),
    switches: A.valves.map((v: any) => ({ at: v.pos, name: v.name, kind: v.kind, lanes: { A: v.lanes.A, B: v.lanes.B } })),
    drops: A.drops.map(([x, y, tick]: number[]) => ({ at: [x, y], tick })),
    blockSupply: 2,
    fog: !!A.fog,
    steal: !!A.steal,
    night: !!A.night,
  };
  writeFileSync(join(OUT, `${m.id}.json`), JSON.stringify(def, null, 2) + '\n');
  console.log(`${m.code} ${m.id}: ${A.w}x${A.h}, goal ${A.n}, ${def.verbs.length} verbs, ${def.switches.length} switches, ${def.drops.length} drops`);
}
