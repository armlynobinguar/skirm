import type { Metadata } from 'next';
import { TermsDoc } from '@/features/legal/LegalDoc';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';

export const metadata: Metadata = shareMeta(
  'Terms of play',
  'The rules of play for skirm: credits, skills, sales, rentals and conduct.',
  routes.terms(),
);

export default function Page() {
  return <TermsDoc />;
}
