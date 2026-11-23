'use client';
// The Exchange's sealed-auction listings (NEXT_PUBLIC_ZAMA_ENABLED): the Exchange tab's "Sealed
// auctions 🔒" row, and a skill's own auction (or the seller's start form) in its detail.
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/services';
import type { SealedAuctionList as List } from '@/lib/api/zamaTypes';
import { SealedAuctionCard } from './SealedAuctionCard';
import { StartSealedAuction } from './StartSealedAuction';
import s from './auctions.module.css';

/** Query key family for the auction lists (StartSealedAuction invalidates it). */
const auctionsKey = (skillId?: string) => ['zama', 'auctions', skillId ?? 'all'] as const;

/** Every registered auction, open first; renders nothing when there is none (or the api has the feature off). */
export function SealedAuctions() {
  const api = useApi();
  const q = useQuery<List>({ queryKey: auctionsKey(), queryFn: () => api.sealedAuctions(), retry: false, staleTime: 15_000 });
  const auctions = q.data?.auctions.filter((a) => a.status === 'open' || Date.now() - Date.parse(a.endsAt) < 7 * 86_400_000) ?? [];
  if (!q.data || auctions.length === 0) return null;
  return (
    <section className={s.section} aria-label="Sealed auctions" data-testid="zama-auctions">
      <div className={s.head}>
        <h2 className={s.title}>Sealed auctions 🔒</h2>
        <span className="sk-kick">cSKIRM · Sepolia · FHE</span>
      </div>
      <p className={s.lede}>
        Bids are encrypted end to end: nobody, the seller included, sees one until the auction closes, and then only the winner and the price open.
        No sniping, no shill probing, no following the crowd.
      </p>
      <div className={s.grid}>
        {auctions.map((a) => (
          <SealedAuctionCard key={a.id} card={a} contract={q.data.contract} />
        ))}
      </div>
    </section>
  );
}

export interface SkillAuctionPanelProps {
  skillId: string;
  version: number;
  /** The viewer holds this version (a minted, transferable one) with no fixed-price listing open. */
  canStart: boolean;
  accountId: string | null;
}

/** A skill's open or latest auction of this version, else the start form for its holder. */
export function SkillAuctionPanel({ skillId, version, canStart, accountId }: SkillAuctionPanelProps) {
  const api = useApi();
  const q = useQuery<List>({ queryKey: auctionsKey(skillId), queryFn: () => api.sealedAuctions(skillId), retry: false, staleTime: 15_000 });
  if (!q.data) return null;
  const mineVersion = q.data.auctions.filter((a) => a.skill.version === version);
  const current = mineVersion.find((a) => a.status === 'open') ?? mineVersion.find((a) => a.status === 'won');
  if (current) return <SealedAuctionCard card={current} contract={q.data.contract} />;
  if (canStart && accountId) return <StartSealedAuction skillId={skillId} version={version} accountId={accountId} onStarted={() => void q.refetch()} />;
  return null;
}
