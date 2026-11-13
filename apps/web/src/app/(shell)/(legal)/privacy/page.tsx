import type { Metadata } from 'next';
import { PrivacyDoc } from '@/features/legal/LegalDoc';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';

export const metadata: Metadata = shareMeta(
  'Privacy',
  'What skirm stores about players, who else sees it, and how to export or delete it.',
  routes.privacy(),
);

export default function Page() {
  return <PrivacyDoc />;
}
