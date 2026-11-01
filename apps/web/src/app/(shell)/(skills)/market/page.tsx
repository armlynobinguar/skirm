import type { Metadata } from 'next';
import { MarketplaceScreen } from '@/features/skills/MarketplaceScreen';

export const metadata: Metadata = { title: 'Marketplace' };

export default function Page() {
  return <MarketplaceScreen />;
}
