import type { Metadata } from 'next';
import { TermsDoc } from '@/features/legal/LegalDoc';

export const metadata: Metadata = { title: 'Terms of play', description: 'The rules of play for skirm: credits, skills, sales, rentals and conduct.' };

export default function Page() {
  return <TermsDoc />;
}
