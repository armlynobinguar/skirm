// What one agent knows on its turn: the board as its crew has seen it (fog), itself, the agents in
// sight, what it heard last tick and its legal actions. This is the only view a decision engine gets.
import type { Dir, Tile } from './map';
import type { Action, AgentState, MatchState, Role } from './match';
import { avoidedTile } from './bluff';
import { legalActions } from './match';
import type { HeardMessage, TalkTier } from './talk';

export interface SeenAgent {
  id: string;
  name: string;
  team: 'A' | 'B';
  role: Role;
  x: number;
  y: number;
  carrying: number;
  down: boolean;
}

export interface Observation {
  tick: number;
  ticksLeft: number;
  map: { id: string; name: string; w: number; h: number; goal: number; item: string; deliverTo: string; exit: [number, number] };
  /** Rows of the board as seen: tile characters, '?' where the crew has never looked. */
  rows: string[];
  me: { id: string; name: string; team: 'A' | 'B'; role: Role; x: number; y: number; carrying: number; capacity: number; tier: TalkTier };
  teammates: SeenAgent[];
  /** Rivals in sight now (all of them on maps without fog). */
  rivals: SeenAgent[];
  score: { mine: number; rival: number };
  blocksLeft: number;
  verbs: { id: string; name: string; effect: string }[];
  heard: HeardMessage[];
  legal: Action[];
}

const CHAR: Record<Tile, string> = {
  wall: '#', grass: ',', tree: 'T', dirt: 'd', water: '~', lava: 'L', fire: '^', item: '*', exit: 'E', crate: 'c', block: 'B', valve: 'V',
};

/** The board as a crew has seen it ('?' never seen), or as it is when `team` is null. */
export function rowsFor(s: MatchState, team: 'A' | 'B' | null): string[] {
  const { w, h } = s.map;
  const src = team ? s.seen[team] : s.grid;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const t = src[y * w + x];
      r += t === undefined ? '?' : t === null ? '.' : CHAR[t];
    }
    rows.push(r);
  }
  return rows;
}

export function observe(s: MatchState, agentId: string): Observation {
  const a = s.agents.find((x) => x.id === agentId);
  if (!a) throw new Error(`no agent ${agentId}`);
  const { w, h, def } = s.map;
  const rows = rowsFor(s, a.team);
  // A bluff it believed: the item reads as open floor until the bluff wears off.
  const gone = avoidedTile(s, a);
  if (gone !== null) {
    const x = gone % w;
    const y = (gone / w) | 0;
    if (rows[y]![x] === '*') rows[y] = rows[y]!.slice(0, x) + '.' + rows[y]!.slice(x + 1);
  }
  const visible = s.visible[a.team];
  const view = (o: AgentState): SeenAgent => ({ id: o.id, name: o.name, team: o.team, role: o.role, x: o.x, y: o.y, carrying: o.carrying.length, down: o.down > 0 });
  const rival = a.team === 'A' ? 'B' : 'A';
  return {
    tick: s.tick + 1,
    ticksLeft: s.limit - s.tick,
    map: { id: def.id, name: def.name, w, h, goal: def.goal, item: def.item, deliverTo: def.deliverTo, exit: def.exit },
    rows,
    me: { id: a.id, name: a.name, team: a.team, role: a.role, x: a.x, y: a.y, carrying: a.carrying.length, capacity: a.role === 'Hauler' ? 3 : 2, tier: a.tier },
    teammates: s.agents.filter((o) => o !== a && o.team === a.team && !o.out).map(view),
    rivals: s.agents.filter((o) => o.team !== a.team && !o.out && visible[o.y * w + o.x]).map(view),
    score: { mine: s.score[a.team], rival: s.score[rival] },
    blocksLeft: s.blocks[a.team],
    verbs: def.verbs.map((v) => ({ id: v.id, name: v.name, effect: v.effect })),
    heard: a.inbox,
    legal: legalActions(s, a.id),
  };
}

/** "move N", "dig_rubble E", "switch", "wait": an action as one token for prompts and logs. */
export function actionText(act: Action): string {
  if (act.type === 'move') return `move ${act.dir}`;
  if (act.type === 'verb') return act.dir ? `${act.verb} ${act.dir}` : act.verb;
  return act.type;
}

/** The reverse of actionText; null when the text names no legal action. */
export function parseAction(text: string, legal: Action[]): Action | null {
  const t = text.trim();
  return legal.find((l) => actionText(l) === t) ?? null;
}

export type { Dir };
