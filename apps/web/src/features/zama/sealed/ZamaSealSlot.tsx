'use client';
// Mounts the sealed-loadout panel on the PvP lock-in only when NEXT_PUBLIC_ZAMA_ENABLED is on and
// there is a real rival (practice has none). The panel (ethers, ABI, relayer SDK) is code-split and
// its loader only exists with the flag on, so the lock-in bundle and flow are unchanged when it is off.
import dynamic from 'next/dynamic';
import { zamaConfig } from '@/lib/zama/config';
import type { SealLoadoutProps } from './SealLoadout';

const SealLoadout = zamaConfig.enabled ? dynamic(() => import('./SealLoadout').then((m) => m.SealLoadout), { ssr: false }) : null;

export function ZamaSealSlot(props: SealLoadoutProps) {
  if (!SealLoadout || !zamaConfig.enabled || props.view.practice || props.view.watch) return null;
  return <SealLoadout {...props} />;
}
