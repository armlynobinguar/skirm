'use client';
// Mounts the on-chain randomness card only when NEXT_PUBLIC_ZAMA_ENABLED is on: live for a match the
// server started on the chain seed (v2_start `zama`), in the debrief for any match SkirmMatch drew
// randomness for (the card renders nothing otherwise). The card (ethers, ABI, relayer) is code-split
// and its loader only exists with the flag on, so the match screens are unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';
import type { ChainRandomnessProps } from './ChainRandomness';

const ChainRandomness = zamaConfig.enabled ? dynamic(() => import('./ChainRandomness').then((m) => m.ChainRandomness), { ssr: false }) : null;

export function ZamaRandomnessSlot(props: ChainRandomnessProps) {
  if (!ChainRandomness || !zamaConfig.enabled) return null;
  return <ChainRandomness {...props} />;
}
