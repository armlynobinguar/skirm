'use client';
// Test bench data: GET /bench, /bench/runs (polled every 2 s while a run is queued or running),
// /bench/runs/:id and /bench/compare. Keys live under ['skills', 'bench'] so invalidating
// qk.skills.all also refreshes them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/queries';
import type { BenchRun, BenchRunRequest } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

export const benchKeys = {
  all: ['skills', 'bench'] as const,
  info: ['skills', 'bench', 'info'] as const,
  runs: (skillId?: string) => ['skills', 'bench', 'runs', skillId ?? null] as const,
  run: (runId: string) => ['skills', 'bench', 'run', runId] as const,
  compare: (a: string, b: string) => ['skills', 'bench', 'compare', a, b] as const,
};

export const isOpen = (r: Pick<BenchRun, 'status'>) => r.status === 'queued' || r.status === 'running';

export function useBenchInfo() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({ queryKey: benchKeys.info, queryFn: () => api.benchInfo(), enabled: status === 'signedIn' });
}

export function useBenchRuns(skillId: string | undefined) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: benchKeys.runs(skillId),
    queryFn: () => api.benchRuns(skillId),
    enabled: status === 'signedIn' && !!skillId,
    refetchInterval: (q) => (q.state.data?.some(isOpen) ? 2000 : false),
  });
}

export function useBenchRun(runId: string) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: benchKeys.run(runId),
    queryFn: () => api.benchRun(runId),
    enabled: status === 'signedIn',
    refetchInterval: (q) => (q.state.data && isOpen(q.state.data) ? 2000 : false),
  });
}

export function useBenchCompare(a: string | undefined, b: string | undefined, enabled = true) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: benchKeys.compare(a ?? '', b ?? ''),
    queryFn: () => api.compareBenchRuns(a!, b!),
    enabled: enabled && status === 'signedIn' && !!a && !!b,
  });
}

/** POST /bench/runs; refreshes the runs, the runs left and (a model run may hold credits) `me`. */
export function useStartBenchRun() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BenchRunRequest) => api.startBenchRun(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: benchKeys.all });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
