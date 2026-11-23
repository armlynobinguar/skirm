'use client';
// Mounts the Sepolia check of a sealed round (./SealedVerify) only when NEXT_PUBLIC_ZAMA_ENABLED is
// on: on /verify under the NEAR panel, and as a "Verify this round" button in the debrief. Both
// render nothing for a match that was not a sealed round. The code (ethers, the ABI, the engine
// replay) is split out and its loader only exists with the flag on, so nothing changes when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';

const SealedVerify = zamaConfig.enabled ? dynamic(() => import('./SealedVerify').then((m) => m.SealedVerify), { ssr: false }) : null;
const VerifyRoundLink = zamaConfig.enabled ? dynamic(() => import('./SealedVerify').then((m) => m.VerifyRoundLink), { ssr: false }) : null;

export function ZamaVerifySlot({ matchId }: { matchId: string }) {
  if (!SealedVerify || !zamaConfig.enabled) return null;
  return <SealedVerify matchId={matchId} />;
}

export function ZamaVerifyRoundSlot({ matchId }: { matchId: string }) {
  if (!VerifyRoundLink || !zamaConfig.enabled) return null;
  return <VerifyRoundLink matchId={matchId} />;
}
