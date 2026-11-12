import type { Metadata } from 'next';
import { MarketplaceScreen } from '@/features/skills/MarketplaceScreen';
import { fetchMarketFirstPage } from '@/lib/api/serverMarket';

export const metadata: Metadata = { title: 'Exchange' };

export default async function Page() {
  // The first page of cards rendered on the server (30 s cache); the client refreshes it on load.
  const initialCards = await fetchMarketFirstPage();
  return <MarketplaceScreen initialCards={initialCards} />;
}
