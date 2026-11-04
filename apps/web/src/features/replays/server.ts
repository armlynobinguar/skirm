// Server-side read of a shared replay for its link preview (Open Graph metadata and image), without
// the frames. The web server reaches the api at API_INTERNAL_URL when set (inside Docker the public
// URL may not resolve), else at the public api URL. Any failure is null: the preview falls back to
// the site's own.
import { cache } from 'react';
import type { SharedReplay } from '@/lib/api/types';
import { config } from '@/lib/config';

const SHARE_ID_RE = /^rps_[A-Za-z0-9_-]{16}$/;

export const fetchSharedMeta = cache(async (shareId: string): Promise<SharedReplay | null> => {
  if (!SHARE_ID_RE.test(shareId)) return null;
  const base = (process.env.API_INTERNAL_URL || config.apiUrl).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/replays/${encodeURIComponent(shareId)}?frames=0`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as SharedReplay;
  } catch {
    return null;
  }
});
