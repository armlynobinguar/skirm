// Loading community maps on screens that take a map id: the crew screen and the match screen.
import { isCommunityMapId } from '@skirm/engine/v2';
import { useQuery } from '@tanstack/react-query';
import { mapById, type V2Map } from '@/features/arena/world';
import { qk } from '@/lib/api/queries';
import { useApi } from '@/lib/services';
import { registerCommunityMap } from './convert';

/**
 * The map for `id`: an official one at once; a community one once it is fetched and registered
 * (then mapById finds it too). `loading` while a community map is on its way; `missing` when there
 * is no such map.
 */
export function useMapById(id: string | undefined): { map: V2Map | undefined; loading: boolean; missing: boolean } {
  const api = useApi();
  const known = id ? mapById(id) : undefined;
  const community = !!id && !known && isCommunityMapId(id);
  const q = useQuery({
    queryKey: qk.communityMaps.one(id ?? ''),
    queryFn: async () => {
      const m = await api.communityMap(id!);
      return registerCommunityMap(m.map, m.theme);
    },
    enabled: community,
    staleTime: Infinity,
    retry: false,
  });
  const map = known ?? q.data;
  return { map, loading: community && q.isPending, missing: !map && (!community || q.isError) };
}
