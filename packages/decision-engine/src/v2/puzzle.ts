// A puzzle run (packages/engine puzzles.ts) on the headless runner: the player's crew against the
// inert rock crew, ending on the puzzle's own check. The model brain reads the puzzle's objective as
// part of each agent's instructions; the greedy brain plays as usual (fetch and deliver) and on a
// reach puzzle walks to the goal tile instead (a go_drop order onto it).
import {
  puzzleGoal,
  puzzleMap,
  puzzleMatchOptions,
  puzzleMedal,
  puzzleObjectiveText,
  puzzleResult,
  puzzleRivals,
  puzzleScore,
  puzzleStatus,
  type AgentSpec,
  type MatchEvent,
  type MatchState,
  type PuzzleDef,
  type PuzzleMedal,
} from '@skirm/engine/v2';
import type { V2AgentContext, V2Brain } from './brain';
import { greedyCommanded } from './greedy';
import { playHeadless, type HeadlessResult } from './headless';

/** A brain that never moves and never speaks (the rock crew). */
export const INERT_BRAIN: V2Brain = {
  kind: 'greedy',
  model: 'inert',
  async act() {
    return { action: { type: 'wait' }, reason: 'chosen', say: null };
  },
  async plan() {
    return { text: null };
  },
};

/** The greedy brain pointed at a reach puzzle's tile; any other brain or puzzle as it is. */
export function puzzleBrain(p: PuzzleDef, brain: V2Brain): V2Brain {
  const g = puzzleGoal(p);
  if (brain.kind !== 'greedy' || g.kind !== 'reach') return brain;
  return {
    kind: brain.kind,
    model: brain.model,
    async act(o, ctx) {
      const step = greedyCommanded(o, { preset: 'go_drop', targets: [g.at] });
      if (step) return { action: step, reason: 'chosen', say: null, thought: 'Heading for the goal tile.' };
      return brain.act(o, ctx);
    },
    plan: (o, ctx) => brain.plan(o, ctx),
  };
}

export interface PuzzleRunOptions {
  puzzle: PuzzleDef;
  /** The player's crew (1 to puzzle.crewSize agents). */
  crew: AgentSpec[];
  brain: V2Brain;
  /** Per agent id: its skills, their triggers and the owner's instructions. */
  contexts?: Partial<Record<string, Pick<V2AgentContext, 'skills' | 'skillTriggers' | 'instructions'>>>;
  deadlineMs?: number;
  onTick?: (events: readonly MatchEvent[], s: Readonly<MatchState>) => void;
}

export interface PuzzleRun {
  solved: boolean;
  /** Ticks played. */
  ticks: number;
  /** The run's score (lower is better), null when not solved. */
  score: number | null;
  medal: PuzzleMedal | null;
  delivered: number;
  knockdowns: number;
  reason: 'goal' | 'time' | 'eliminated';
  headless: HeadlessResult;
}

export async function playPuzzle(opts: PuzzleRunOptions): Promise<PuzzleRun> {
  const { puzzle: p, crew } = opts;
  if (crew.length < 1 || crew.length > p.crewSize) throw new Error(`${p.id} takes 1 to ${p.crewSize} agents`);
  const objective = puzzleObjectiveText(p);
  const contexts: NonNullable<PuzzleRunOptions['contexts']> = {};
  for (const a of crew) {
    const c = opts.contexts?.[a.id] ?? { skills: [] };
    contexts[a.id] = { ...c, instructions: c.instructions ? `${objective}\n\n${c.instructions}` : objective };
  }
  let last: Readonly<MatchState> | undefined;
  const o = puzzleMatchOptions(p);
  const headless = await playHeadless({
    def: puzzleMap(p),
    crews: { A: crew, B: puzzleRivals(crew.length) },
    brains: { A: puzzleBrain(p, opts.brain), B: INERT_BRAIN },
    contexts,
    seed: `puzzle:${p.id}`,
    difficulty: o.difficulty,
    hold: o.hold,
    lieCap: o.lieCap,
    match: { ticks: o.ticks },
    judge: (s) => puzzleResult(p, s),
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
    onTick: (ev, s) => {
      last = s;
      opts.onTick?.(ev, s);
    },
  });
  const solved = !!last && puzzleStatus(p, last) === 'solved';
  const knockdowns = last?.tally.A.swept ?? 0;
  const delivered = headless.score.A;
  const score = solved ? puzzleScore(p, { ticks: headless.ticks, knockdowns, delivered }) : null;
  return {
    solved,
    ticks: headless.ticks,
    score,
    medal: score === null ? null : puzzleMedal(p, score),
    delivered,
    knockdowns,
    reason: headless.result.reason,
    headless,
  };
}
