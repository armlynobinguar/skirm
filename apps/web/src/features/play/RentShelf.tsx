'use client';
// Rented agents on the crew screen (the prototype's agent rentals). Two rows under your roster:
//   passes   agents you have rented and not played yet: pick them like your own; one match each,
//            used up when that match ends (a void match keeps the pass)
//   offers   other players' agents for rent at a price per match: Rent pays `market.rent` from your
//            linked wallet (dev mode: a `dev:<yocto>:<nonce>` hash) and POST /rentals/:offerId
//            turns the payment into a pass
// A rented agent plays with its owner's skills; you never see them, and its plans stay hidden.
import { defaultAppearance } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import c from '@/features/agents/crew.module.css';
import { agentBone, agentColour } from '@/features/agents/agentView';
import { devTxHash } from '@/features/skills/lib';
import { useToast } from '@/components/toast/ToastProvider';
import { useSession } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { qk } from '@/lib/api/queries';
import type { Agent, RentalOffer, RentalPass } from '@/lib/api/types';
import { formatNear } from '@/lib/constants';
import { useApi } from '@/lib/services';
import { rentTx } from '@/lib/wallet/contracts';
import { useNearSigner } from '@/lib/wallet/hooks';
import { WalletError } from '@/lib/wallet/types';
import styles from './play.module.css';

const ROLES: Agent['role'][] = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'];
const TIERS: Agent['tier'][] = ['quiet', 'standard', 'open'];

/** A rented agent as the crew cards draw it: its public stats, no skills (they stay its owner's). */
export function rentedAgent(p: RentalPass): Agent {
  const a = p.agent;
  return {
    id: p.agentId,
    name: a?.name ?? 'Rented agent',
    elo: 1200,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    skills: [],
    unlocks: [],
    appearance: defaultAppearance(p.agentId),
    role: ROLES.includes(a?.role as Agent['role']) ? (a!.role as Agent['role']) : 'Runner',
    vision: a?.vision ?? 3,
    comms: a?.comms ?? 3,
    tier: TIERS.includes(a?.tier as Agent['tier']) ? (a!.tier as Agent['tier']) : 'standard',
  };
}

/** One pass per rented agent (several passes for one agent still pick it once). */
export function passesByAgent(passes: readonly RentalPass[]): RentalPass[] {
  const seen = new Set<string>();
  return passes.filter((p) => (seen.has(p.agentId) ? false : (seen.add(p.agentId), true)));
}

const nonce = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;

export function RentShelf({
  passes,
  picked,
  onToggle,
  disabled,
  nearId,
}: {
  passes: readonly RentalPass[];
  picked: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** The linked NEAR account (renting outside dev mode signs with it). */
  nearId: string | null;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { mode } = useSession();
  const signer = useNearSigner();
  const offers = useQuery({ queryKey: qk.rentalOffers, queryFn: () => api.rentalOffers(), retry: false });
  // Signed but not yet recorded (the POST failed): re-sent as is, never signed (paid) twice.
  const signed = useRef<{ offerId: string; txHash: string } | null>(null);
  const counts = new Map<string, number>();
  for (const p of passes) counts.set(p.agentId, (counts.get(p.agentId) ?? 0) + 1);

  const rent = useMutation({
    mutationFn: async (o: RentalOffer) => {
      let txHash: string;
      if (mode === 'dev') txHash = devTxHash(o.priceYocto);
      else if (signed.current?.offerId === o.offerId) txHash = signed.current.txHash;
      else {
        if (!nearId) throw new WalletError('wallet_no_account', 'Link a NEAR account to rent an agent.');
        if (!o.ownerNearAccountId) throw new ApiError(409, 'owner_unlinked', `${o.ownerHandle} has no NEAR account to be paid.`);
        txHash = await signer.send(rentTx(signer.contracts, o.offerId, nonce(), o.ownerNearAccountId, o.priceYocto), nearId);
        signed.current = { offerId: o.offerId, txHash };
      }
      const r = await api.rent(o.offerId, txHash);
      signed.current = null;
      return r;
    },
    onSuccess: (_r, o) => {
      void qc.invalidateQueries({ queryKey: qk.myRentals });
      toast.show({ tone: 'good', title: `${o.name} is yours for one match`, message: 'Pick it under Rented to field it.' });
    },
    onError: (err) => toast.show({ tone: 'critical', title: 'Rental not completed', message: err instanceof ApiError ? err.message : 'Try again.' }),
  });

  const list = offers.data ?? [];
  return (
    <section className={styles.rentShelf} aria-label="Rented agents" data-testid="s04-rent">
      {passes.length ? (
        <>
          <span className="sk-kick">Rented · one match each</span>
          <div className={c.roster} role="group" aria-label="Rented agents">
            {passesByAgent(passes).map((p) => {
              const a = rentedAgent(p);
              const n = counts.get(p.agentId) ?? 1;
              return (
                <button
                  key={p.agentId}
                  type="button"
                  className={c.rpick}
                  aria-pressed={picked.includes(p.agentId)}
                  disabled={disabled}
                  onClick={() => onToggle(p.agentId)}
                  title={`Rented from ${p.agent?.ownerHandle ?? 'another player'}${n > 1 ? ` · ${n} matches left` : ''}`}
                  data-testid={`s04-rented-${p.agentId}`}
                >
                  <AgentPortrait body={agentColour(a)} head={agentBone(a)} label={a.name} className={c.face} />
                  <span>{a.name}</span>
                  <small>{n > 1 ? `${n} left` : a.role}</small>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {list.length ? (
        <>
          <span className="sk-kick">Rent an agent · 5% platform fee</span>
          <ul className={styles.rentList}>
            {list.slice(0, 6).map((o) => (
              <li key={o.offerId} data-testid={`s04-offer-${o.offerId}`}>
                <span>
                  <b>{o.name}</b> · {o.role} · vision {o.vision} · comms {o.comms}
                  <small> from {o.ownerHandle}</small>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || rent.isPending || (mode !== 'dev' && !o.ownerNearAccountId)}
                  onClick={() => rent.mutate(o)}
                  data-testid={`s04-rent-${o.offerId}`}
                >
                  Rent · {formatNear(BigInt(o.priceYocto))} NEAR
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
