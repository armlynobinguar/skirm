'use client';
// Mounts the sealed-auction listings on the Exchange only when NEXT_PUBLIC_ZAMA_ENABLED is on. The
// components (ethers, ABI, relayer) are code-split and their loaders only exist with the flag on, so
// the Exchange is unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';
import type { SkillAuctionPanelProps } from './SealedAuctions';

const SealedAuctions = zamaConfig.enabled ? dynamic(() => import('./SealedAuctions').then((m) => m.SealedAuctions), { ssr: false }) : null;
const SkillAuctionPanel = zamaConfig.enabled ? dynamic(() => import('./SealedAuctions').then((m) => m.SkillAuctionPanel), { ssr: false }) : null;

/** The Exchange tab's "Sealed auctions 🔒" row. */
export function ZamaAuctionsSlot() {
  if (!SealedAuctions || !zamaConfig.enabled || !zamaConfig.contracts.auction) return null;
  return <SealedAuctions />;
}

/** A skill's sealed auction (bid box, outcome) or the holder's start form, in the skill detail. */
export function ZamaSkillAuctionSlot(props: SkillAuctionPanelProps) {
  if (!SkillAuctionPanel || !zamaConfig.enabled || !zamaConfig.contracts.auction) return null;
  return <SkillAuctionPanel {...props} />;
}
