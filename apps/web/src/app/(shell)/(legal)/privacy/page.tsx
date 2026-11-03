import type { Metadata } from 'next';
import { PrivacyDoc } from '@/features/legal/LegalDoc';

export const metadata: Metadata = { title: 'Privacy', description: 'What skirm stores about players, who else sees it, and how to export or delete it.' };

export default function Page() {
  return <PrivacyDoc />;
}
