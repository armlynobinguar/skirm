// The Exchange's first page (GET /market, default sort, no tag) fetched on the server, so the cards
// are in the HTML instead of waiting for the bundle, hydration and the session to settle. Cached for
// 30 s (time-based revalidation). Best effort: a slow or unreachable api (a build without one, a
// local stack where the api is another container) gives undefined, and the page fetches as before.
import type { MarketCard } from './types';
import { config } from '../config';

const TIMEOUT_MS = 1500;

export async function fetchMarketFirstPage(): Promise<MarketCard[] | undefined> {
  try {
    const res = await fetch(`${config.apiUrl}/market?sort=winrate`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return Array.isArray(body) ? (body as MarketCard[]) : undefined;
  } catch {
    return undefined;
  }
}
