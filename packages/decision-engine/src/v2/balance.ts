// The balance check for community maps: a few quick headless matches, greedy against greedy, over a
// spread of difficulties and crew sizes ("seeds": the engine and the greedy brain are
// deterministic, so a seed is a difficulty and a crew size). Every seed is played twice, the second
// time with the crews' starts swapped, so the engine's own crew-order tie breaks fall on each half
// once and what is left is the map: wins are counted by the half a crew started on (left / right).
// On a fair map neither half wins much more often than the other, and the map is playable
// (somebody scores in most matches, the hazards wipe nobody out). It is what the map editor's Test
// play shows and what publishing requires. Every run is free: the greedy brain makes no model calls.
import { botCrew, type Action, type Difficulty, type Dir, type MapDefV2, type MatchResult, type Observation, type Team } from '@skirm/engine/v2';
import { createGreedyBrain, type V2Brain } from './brain';
import { playHeadless } from './headless';

export interface BalanceSeed {
  difficulty: Difficulty;
  size: 1 | 2 | 3;
}

/** The default spread: Easy to Hard, one to three agents a side (capped by the map's starts). */
export const BALANCE_SEEDS: readonly BalanceSeed[] = [
  { difficulty: 'easy', size: 1 },
  { difficulty: 'normal', size: 2 },
  { difficulty: 'normal', size: 1 },
  { difficulty: 'hard', size: 3 },
];

export type MapSide = 'left' | 'right';

export interface BalanceRun {
  /** `<difficulty>:<size>v<size>`, plus `:swapped` for the run with the starts swapped. */
  seed: string;
  difficulty: Difficulty;
  size: number;
  /** Crew A started on the right half. */
  swapped: boolean;
  winner: MatchResult['winner'];
  /** The half the winner started on. */
  side: MapSide | 'draw';
  reason: MatchResult['reason'];
  decidedBy: MatchResult['decidedBy'];
  score: Record<Team, number>;
  ticks: number;
}

export interface BalanceReport {
  runs: BalanceRun[];
  /** Wins by the half the winning crew started on. */
  wins: { left: number; right: number; draw: number };
  /** Neither half won more than `maxLead` matches more than the other. */
  fair: boolean;
  /** Somebody scored in at least half the matches and none ended in an elimination. */
  playable: boolean;
  /** fair and playable: what publishing requires. */
  ok: boolean;
  /** Why it is not ok, in words for the editor. */
  problems: string[];
}

export interface BalanceOptions {
  seeds?: readonly BalanceSeed[];
  /** Most wins one half may have over the other (default: a quarter of the runs). */
  maxLead?: number;
}

const FLIP: Record<Dir, Dir> = { N: 'N', S: 'S', E: 'W', W: 'E' };
const flipAction = (a: Action): Action => (a.type === 'move' ? { ...a, dir: FLIP[a.dir] } : a.type === 'verb' && a.dir ? { ...a, dir: FLIP[a.dir] } : a);

/**
 * `brain` playing as if the board were flipped left to right: it sees a mirrored observation and
 * its moves are flipped back. The greedy brain breaks ties by direction order, which favours one
 * half of a mirrored board; giving the right-half crew a mirrored view makes both crews read the
 * same board, so what is left between them is the map.
 */
export function mirroredBrain(brain: V2Brain): V2Brain {
  const fx = (w: number, x: number) => w - 1 - x;
  const flip = (o: Observation): Observation => {
    const w = o.map.w;
    const seen = <T extends { x: number }>(a: T): T => ({ ...a, x: fx(w, a.x) });
    return {
      ...o,
      map: { ...o.map, exit: [fx(w, o.map.exit[0]), o.map.exit[1]] },
      rows: o.rows.map((r) => [...r].reverse().join('')),
      me: seen(o.me),
      teammates: o.teammates.map(seen),
      rivals: o.rivals.map(seen),
      ...(o.bluff ? { bluff: { ...o.bluff, at: [fx(w, o.bluff.at[0]), o.bluff.at[1]] } } : {}),
      legal: o.legal.map(flipAction),
    };
  };
  return {
    kind: brain.kind,
    model: brain.model,
    act: async (o, ctx) => {
      const d = await brain.act(flip(o), ctx);
      return { ...d, action: flipAction(d.action) };
    },
    plan: (o, ctx) => brain.plan(flip(o), ctx),
  };
}

/** Plays the seeds on `def` (already validated), each both ways round, and judges the result. */
export async function balanceCheck(def: MapDefV2, opts: BalanceOptions = {}): Promise<BalanceReport> {
  const seeds = opts.seeds ?? BALANCE_SEEDS;
  const limit = Math.max(1, Math.min(3, def.starts.A.length, def.starts.B.length)) as 1 | 2 | 3;
  const swappedDef: MapDefV2 = { ...def, starts: { A: def.starts.B, B: def.starts.A } };
  const runs: BalanceRun[] = [];
  for (const s of seeds)
    for (const swapped of [false, true]) {
      const size = Math.min(s.size, limit) as 1 | 2 | 3;
      const seed = `${s.difficulty}:${size}v${size}${swapped ? ':swapped' : ''}`;
      const r = await playHeadless({
        def: swapped ? swappedDef : def,
        difficulty: s.difficulty,
        crews: { A: botCrew(size, 'a'), B: botCrew(size, 'b') },
        brains: swapped ? { A: mirroredBrain(createGreedyBrain()), B: createGreedyBrain() } : { A: createGreedyBrain(), B: mirroredBrain(createGreedyBrain()) },
        seed,
      });
      const w = r.result.winner;
      const side: BalanceRun['side'] = w === 'draw' ? 'draw' : (w === 'A') !== swapped ? 'left' : 'right';
      runs.push({ seed, difficulty: s.difficulty, size, swapped, winner: w, side, reason: r.result.reason, decidedBy: r.result.decidedBy, score: r.score, ticks: r.ticks });
    }
  return judge(runs, opts.maxLead);
}

/** The verdict on a set of runs (exported for tests). */
export function judge(runs: BalanceRun[], maxLead = Math.max(1, Math.floor(runs.length / 4))): BalanceReport {
  const wins = { left: 0, right: 0, draw: 0 };
  for (const r of runs) wins[r.side]++;
  const problems: string[] = [];
  const fair = Math.abs(wins.left - wins.right) <= maxLead;
  if (!fair)
    problems.push(`the crew starting on the ${wins.left > wins.right ? 'left' : 'right'} won ${Math.max(wins.left, wins.right)} of ${runs.length} test matches: the halves are not even`);
  const scored = runs.filter((r) => r.score.A + r.score.B > 0).length;
  const wiped = runs.filter((r) => r.reason === 'eliminated').length;
  if (scored * 2 < runs.length) problems.push(`nobody delivered anything in ${runs.length - scored} of ${runs.length} test matches: make the items reachable`);
  if (wiped) problems.push(`a crew was wiped out in ${wiped} test match${wiped > 1 ? 'es' : ''}: the hazards are too deadly`);
  const playable = scored * 2 >= runs.length && !wiped;
  return { runs, wins, fair, playable, ok: fair && playable, problems };
}
