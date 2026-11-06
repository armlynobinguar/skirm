import type { Metadata } from 'next';
import { MarketplaceScreen } from '@/features/skills/MarketplaceScreen';

export const metadata: Metadata = { title: 'Exchange' };

export default function Page() {
  return <MarketplaceScreen />;
}
