'use client';
// Daily challenge data: GET /daily (polled every 2 s while an attempt is queued or playing),
// GET /daily/leaderboard (refreshed when an attempt finishes) and POST /daily/attempts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/queries';
import type { DailyAttempt } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

export const dailyKeys = {
  all: ['daily'] as const,
  today: ['daily', 'today'] as const,
  board: (date: string | null) => ['daily', 'board', date] as const,
};

export const isOpen = (a: Pick<DailyAttempt, 'status'>) => a.status === 'queued' || a.status === 'running';

export function useDaily() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: dailyKeys.today,
    queryFn: () => api.daily(),
    enabled: status === 'signedIn',
    refetchInterval: (q) => (q.state.data?.mine.some(isOpen) ? 2000 : false),
  });
}

/** A day's board; `date` null is today. */
export function useDailyBoard(date: string | null) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: dailyKeys.board(date),
    queryFn: () => api.dailyBoard(date ?? undefined),
    enabled: status === 'signedIn',
  });
}

/** POST /daily/attempts; refreshes the attempts, the board and (a model run may hold credits) `me`. */
export function useStartDailyAttempt() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentIds: string[] | undefined) => api.startDailyAttempt(agentIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dailyKeys.all });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
