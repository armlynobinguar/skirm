import type { Metadata } from 'next';
import { CampaignScreen } from '@/features/campaign/CampaignScreen';

export const metadata: Metadata = { title: 'Campaign' };

export default function Page() {
  return <CampaignScreen />;
}
