'use client';
// "Rent out" tile on the agent editor (the prototype's "Agent rentals" earn-back line): offer this
// agent to other players at a price per match (PUT /agents/:id/rental), or stop. Renters pay
// through `market.rent`; the market's 5% platform fee comes out of the price and the rest goes to
// the owner's linked NEAR account, so offering needs one. The agent plays with your skills and
// renters never see them (realtime withholds its plans); you keep it, and it cannot be in two
// matches at once.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { ApiError } from '@/lib/api/errors';
import { qk } from '@/lib/api/queries';
import { formatNear, parseNear } from '@/lib/constants';
import { useApi } from '@/lib/services';
import e from './agentEditor.module.css';

/** The market's platform fee on rentals, as on skill sales (contracts/market DEFAULT_FEE_BPS). */
export const RENTAL_FEE_BPS = 500n;

export function RentOut({ agentId, agentName, linked }: { agentId: string; agentName: string; linked: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const mine = useQuery({ queryKey: qk.myRentals, queryFn: () => api.myRentals(), retry: false });
  const offer = mine.data?.offers.find((o) => o.agentId === agentId && o.active) ?? null;
  const [price, setPrice] = useState('');
  let yocto: string | null = null;
  try {
    yocto = price.trim() ? parseNear(price) : null;
  } catch {
    yocto = null;
  }
  const valid = yocto !== null && BigInt(yocto) > 0n;
  const set = useMutation({
    mutationFn: (p: string | null) => api.setRentalOffer(agentId, p),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.myRentals });
      void qc.invalidateQueries({ queryKey: qk.rentalOffers });
      setPrice('');
      toast.show({ tone: 'good', title: r.offer ? `${agentName} is offered for ${formatNear(BigInt(r.offer.priceYocto))} NEAR a match.` : `${agentName} is no longer for rent.` });
    },
    onError: (err) => toast.show({ tone: 'critical', title: 'Offer not changed', message: err instanceof ApiError ? err.message : 'Could not change the offer.' }),
  });
  const keep = valid ? BigInt(yocto!) - (BigInt(yocto!) * RENTAL_FEE_BPS) / 10_000n : null;

  return (
    <section className={e.tierBox} aria-label="Rent out" data-rise style={{ '--rise-i': 4 } as CSSProperties} data-testid="agent-rent-out">
      <div className={e.tierHead}>
        <span className={e.code}>Rent out · per match</span>
        <b data-testid="agent-rent-state">{offer ? `${formatNear(BigInt(offer.priceYocto))} NEAR` : 'Not offered'}</b>
      </div>
      {linked ? (
        <div className={e.row}>
          <input
            className={e.rentInput}
            inputMode="decimal"
            placeholder={offer ? 'New price in NEAR' : 'Price in NEAR, e.g. 0.5'}
            value={price}
            onChange={(ev) => setPrice(ev.target.value)}
            aria-label={`Rental price per match for ${agentName}, in NEAR`}
            data-testid="agent-rent-price"
          />
          <button type="button" className={`${e.btn} ${e.primary}`} disabled={!valid || set.isPending} onClick={() => set.mutate(yocto)} data-testid="agent-rent-offer">
            {offer ? 'Reprice' : 'Offer'}
          </button>
          {offer ? (
            <button type="button" className={e.btn} disabled={set.isPending} onClick={() => set.mutate(null)} data-testid="agent-rent-stop">
              Stop
            </button>
          ) : null}
        </div>
      ) : null}
      <span className={e.sub} data-testid="agent-rent-note">
        {!linked
          ? 'Link a NEAR account to rent this agent out: renters pay it directly.'
          : keep !== null
            ? `You get ${formatNear(keep)} NEAR a match after the 5% platform fee.`
            : 'Other players field it for one match; it plays with your skills, which they never see. 5% platform fee.'}
      </span>
    </section>
  );
}
