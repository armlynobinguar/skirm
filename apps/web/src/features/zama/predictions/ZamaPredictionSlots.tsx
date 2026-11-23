'use client';
// Mounts the spectator prediction panel (live) and claim (debrief) only when NEXT_PUBLIC_ZAMA_ENABLED
// is on and MatchPredictions is deployed. The components (ethers, ABI, relayer) are code-split and
// their loaders only exist with the flag on, so the match screens are unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';
import type { PredictPanelProps } from './PredictPanel';
import type { PredictionClaimProps } from './PredictionClaim';

const on = zamaConfig.enabled && !!zamaConfig.contracts.predictions;
const PredictPanel = on ? dynamic(() => import('./PredictPanel').then((m) => m.PredictPanel), { ssr: false }) : null;
const PredictionClaim = on ? dynamic(() => import('./PredictionClaim').then((m) => m.PredictionClaim), { ssr: false }) : null;

/** "Predict 🔒" over a match a spectator watches live. */
export function ZamaPredictSlot(props: PredictPanelProps) {
  if (!PredictPanel) return null;
  return <PredictPanel {...props} />;
}

/** "Claim 🔒" in the debrief, for a wallet that predicted on the match. */
export function ZamaPredictionClaimSlot(props: PredictionClaimProps) {
  if (!PredictionClaim) return null;
  return <PredictionClaim {...props} />;
}
