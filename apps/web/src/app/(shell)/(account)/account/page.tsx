import type { Metadata } from 'next';
import { ProfileScreen } from '@/features/account/ProfileScreen';

export const metadata: Metadata = { title: 'Profile and settings' };

export default function Page() {
  return <ProfileScreen />;
}
