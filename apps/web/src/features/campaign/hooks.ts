'use client';
// Campaign data (GET /campaign) and the start call (POST /campaign/missions/:id/start).
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

/** Under `me`, so a match end (qk.me invalidated) refreshes the chapter map too. */
export const campaignKey = ['me', 'campaign'] as const;

export function useCampaign(opts: { enabled?: boolean } = {}) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: campaignKey,
    queryFn: () => api.campaign(),
    enabled: status === 'signedIn' && (opts.enabled ?? true),
    staleTime: 15_000,
    retry: false,
  });
}

export function useStartMission() {
  const api = useApi();
  return useMutation({ mutationFn: (missionId: string) => api.startMission(missionId) });
}
