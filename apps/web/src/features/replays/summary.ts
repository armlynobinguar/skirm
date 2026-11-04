// A shared replay in one line: the cover's heading and the link preview's description. No
// directive, so the server page (metadata) and the client screen both use it.
import { mapV2 } from '@skirm/engine/v2';
import type { SharedReplay } from '@/lib/api/types';

export function sharedSummary(d: Pick<SharedReplay, 'match'>): string {
  const m = d.match;
  const a = m.teams.A.handle ?? 'Crew A';
  const b = m.teams.B.handle ?? 'Crew B';
  const map = mapV2(m.mapId)?.name ?? m.mapId;
  if (!m.score || !m.winner) return `${a} vs ${b} on ${map}.`;
  const verdict = m.winner === 'draw' ? 'draw' : `${m.winner === 'A' ? a : b} wins`;
  return `${a} vs ${b} on ${map}: ${m.score.A}–${m.score.B}, ${verdict}.`;
}
