'use client';
// Mounts the confidential action's progress only when NEXT_PUBLIC_ZAMA_ENABLED is on.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';

const ZamaProgress = dynamic(() => import('./ZamaProgress').then((m) => m.ZamaProgress), { ssr: false });

export function ZamaProgressSlot() {
  return zamaConfig.enabled ? <ZamaProgress /> : null;
}
