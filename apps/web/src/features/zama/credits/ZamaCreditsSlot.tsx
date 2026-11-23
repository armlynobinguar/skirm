'use client';
// Mounts the cSKIRM widget only when NEXT_PUBLIC_ZAMA_ENABLED is on. The widget (ethers, ABI,
// and later the relayer SDK) is code-split so the credits page bundle is unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';

const CSkirmBalance = dynamic(() => import('./CSkirmBalance').then((m) => m.CSkirmBalance), { ssr: false });

export function ZamaCreditsSlot() {
  return zamaConfig.enabled ? <CSkirmBalance /> : null;
}
