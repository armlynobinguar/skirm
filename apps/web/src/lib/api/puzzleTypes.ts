// GET /puzzles, GET /puzzles/:id, POST /puzzles/:id/runs, GET /puzzles/:id/runs/:runId and
// GET /puzzles/:id/leaderboard (apps/api puzzles.controller.ts).

export type PuzzleMedal = 'gold' | 'silver' | 'bronze';
export type PuzzleGoal = { kind: 'deliver'; count: number } | { kind: 'reach'; at: [number, number] } | { kind: 'survive'; ticks: number };
export type TalkTier = 'quiet' | 'standard' | 'open';

export interface PuzzleBest {
  score: number;
  ticks: number;
  medal: PuzzleMedal | null;
  runId: string;
  logHash: string;
  brain: string;
  solves: number;
  achievedAt: string;
}

export interface PuzzleView {
  id: string;
  n: number;
  title: string;
  briefing: string;
  goal: PuzzleGoal;
  crewSize: 1 | 2 | 3;
  /** The run fails on this tick. */
  cap: number;
  /** The gold threshold. */
  par: number;
  medals: Record<PuzzleMedal, number>;
  item: string;
  deliverTo: string;
  /** Credits a one-agent run holds on a model brain; 0 on the offline greedy brain. */
  costCredits: number;
  best: PuzzleBest | null;
}

export interface PuzzleList {
  brain: string;
  free: boolean;
  limit: { perHour: number; used: number; left: number };
  puzzles: PuzzleView[];
  medals: Record<PuzzleMedal, number> & { solved: number; total: number };
}

export interface PuzzleEvent {
  tick: number;
  side: 'you' | 'bot' | 'map';
  kind: string;
  text: string;
}

export interface PuzzleRunResult {
  puzzleId: string;
  solved: boolean;
  reason: 'goal' | 'time' | 'eliminated' | string;
  ticks: number;
  score: number | null;
  medal: PuzzleMedal | null;
  delivered: number;
  knockdowns: number;
  logHash: string;
  best: boolean;
  crew: { agentId: string; name: string; role: string }[];
  calls: number;
  events: PuzzleEvent[];
  eventsDropped: number;
}

export interface PuzzleRun {
  id: string;
  puzzleId: string;
  crew: { agentId: string; tier: TalkTier }[];
  status: 'queued' | 'running' | 'done' | 'failed' | 'insufficient_credits';
  brain: string | null;
  credits: number;
  result: PuzzleRunResult | null;
  shortfall: { need: number; have: number } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface PuzzleDetail extends PuzzleView {
  board: {
    /** The left half of the board, centre column last: '1'..'3' starts, 'X' a reach goal, else v2 tiles. */
    layout: string[];
    w: number;
    h: number;
    hazards: { kind: 'water' | 'fire' | 'lava'; every: number; cap: number }[];
    blockSupply: number;
  };
  runs: PuzzleRun[];
}

export interface PuzzleRunRequest {
  crew: { agentId: string; tier?: TalkTier }[];
}

export interface PuzzleBoardEntry {
  rank: number;
  account: { id: string; handle: string };
  score: number;
  ticks: number;
  medal: PuzzleMedal | null;
  logHash: string;
  brain: string;
  achievedAt: string;
}

export interface PuzzleLeaderboard {
  puzzleId: string;
  par: number;
  medals: Record<PuzzleMedal, number>;
  entries: PuzzleBoardEntry[];
}
