'use client';
// Puzzle data: GET /puzzles, /puzzles/:id, the leaderboard, and a run polled every 2 s while it is
// queued or running. Keys live under ['me', 'puzzles'] so a match end (qk.me invalidated) refreshes
// them too, and a finished run refreshes the list, the puzzle and its board.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PuzzleRun, PuzzleRunRequest } from '@/lib/api/puzzleTypes';
import { qk } from '@/lib/api/queries';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

export const puzzleKeys = {
  all: ['me', 'puzzles'] as const,
  list: ['me', 'puzzles', 'list'] as const,
  one: (id: string) => ['me', 'puzzles', 'one', id] as const,
  run: (id: string, runId: string) => ['me', 'puzzles', 'run', id, runId] as const,
  board: (id: string) => ['me', 'puzzles', 'board', id] as const,
};

export const isOpen = (r: Pick<PuzzleRun, 'status'>) => r.status === 'queued' || r.status === 'running';

export function usePuzzles() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({ queryKey: puzzleKeys.list, queryFn: () => api.puzzles(), enabled: status === 'signedIn', staleTime: 15_000, retry: false });
}

export function usePuzzle(id: string) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({ queryKey: puzzleKeys.one(id), queryFn: () => api.puzzle(id), enabled: status === 'signedIn', retry: false });
}

export function usePuzzleBoard(id: string) {
  const api = useApi();
  return useQuery({ queryKey: puzzleKeys.board(id), queryFn: () => api.puzzleLeaderboard(id), retry: false });
}

/** One run, polled until it is done (then the list, puzzle and board refresh once). */
export function usePuzzleRun(id: string, runId: string | null) {
  const api = useApi();
  const qc = useQueryClient();
  const { status } = useSession();
  return useQuery({
    queryKey: puzzleKeys.run(id, runId ?? ''),
    queryFn: async () => {
      const r = await api.puzzleRun(id, runId!);
      if (!isOpen(r)) {
        void qc.invalidateQueries({ queryKey: puzzleKeys.one(id) });
        void qc.invalidateQueries({ queryKey: puzzleKeys.list });
        void qc.invalidateQueries({ queryKey: puzzleKeys.board(id) });
      }
      return r;
    },
    enabled: status === 'signedIn' && !!runId,
    refetchInterval: (q) => (q.state.data && !isOpen(q.state.data) ? false : 2000),
  });
}

/** POST /puzzles/:id/runs; a model run may hold credits, so `me` refreshes too. */
export function useStartPuzzleRun(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PuzzleRunRequest) => api.startPuzzleRun(id, body),
    onSuccess: (run) => {
      qc.setQueryData(puzzleKeys.run(id, run.id), run);
      void qc.invalidateQueries({ queryKey: qk.me, exact: true });
    },
  });
}
