import type { Metadata } from 'next';
import { SignInScreen } from '@/features/play/SignInScreen';

// The landing page: the root layout's default title and description, plus its canonical URL.
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function Page() {
  return <SignInScreen />;
}
