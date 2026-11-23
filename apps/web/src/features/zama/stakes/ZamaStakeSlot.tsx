'use client';
// Mounts the stake escrow card in the debrief only when NEXT_PUBLIC_ZAMA_ENABLED is on (the card
// renders nothing for a match without stakes or settlement on chain). The card (ethers, ABI, relayer)
// is code-split and its loader only exists with the flag on, so the debrief is unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';
import type { StakePayoutProps } from './StakePayout';

const StakePayout = zamaConfig.enabled ? dynamic(() => import('./StakePayout').then((m) => m.StakePayout), { ssr: false }) : null;

export function ZamaStakeSlot(props: StakePayoutProps) {
  if (!StakePayout || !zamaConfig.enabled) return null;
  return <StakePayout {...props} />;
}
