'use client';
// Rented agents on the crew screen (the prototype's agent rentals). Two rows under your roster:
//   passes   agents you have rented and not played yet: pick them like your own; one match each,
//            used up when that match ends (a void match keeps the pass)
//   offers   other players' agents for rent at a price per match. How Rent pays follows the api's
//            `payWith` (NEAR_RENTALS_ONCHAIN): `near` signs `market.rent` from your linked wallet,
//            `credits` spends paid credits; dev mode pays with a `dev:<yocto>:<nonce>` hash. POST
//            /rentals/:offerId turns the payment into a pass. A signed tx (or a credits key) is kept
//            until the api answers, so a retry after a dropped request never pays twice.
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

/** A payment made but not yet turned into a pass: a signed tx hash, or the key of a credits rental. */
interface Pending {
  offerId: string;
  txHash?: string;
  key?: string;
}

// Kept in localStorage too, so a reload after signing re-sends the same tx instead of paying again.
const PENDING_KEY = 'skirm:rent:pending';
function loadPending(): Pending | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null;
    return v && typeof v.offerId === 'string' ? v : null;
  } catch {
    return null;
  }
}
function savePending(p: Pending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage off (private window): the in-memory copy still covers retries on this page.
  }
}

/** Api refusals that will not change on a retry: drop the pending payment so the next click pays afresh. */
const isFinal = (err: unknown) => err instanceof ApiError && (err.status === 409 || err.status === 422 || err.status === 402 || err.status === 403);

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
  // Paid but not yet recorded (the POST failed): re-sent as is, never signed (paid) twice.
  const pending = useRef<Pending | null>(null);
  if (pending.current === null && typeof window !== 'undefined') pending.current = loadPending();
  const remember = (p: Pending | null) => {
    pending.current = p;
    savePending(p);
  };
  const counts = new Map<string, number>();
  for (const p of passes) counts.set(p.agentId, (counts.get(p.agentId) ?? 0) + 1);

  const rent = useMutation({
    mutationFn: async (o: RentalOffer) => {
      const prior = pending.current?.offerId === o.offerId ? pending.current : null;
      try {
        if (mode === 'dev') return await api.rent(o.offerId, devTxHash(o.priceYocto));
        if (o.payWith === 'credits') {
          const key = prior?.key ?? nonce();
          remember({ offerId: o.offerId, key });
          const r = await api.rentWithCredits(o.offerId, key);
          remember(null);
          return r;
        }
        let txHash = prior?.txHash;
        if (!txHash) {
          if (!nearId) throw new WalletError('wallet_no_account', 'Link a NEAR account to rent an agent.');
          if (!o.ownerNearAccountId) throw new ApiError(409, 'owner_unlinked', `${o.ownerHandle} has no NEAR account to be paid.`);
          txHash = await signer.send(rentTx(signer.contracts, o.offerId, nonce(), o.ownerNearAccountId, o.priceYocto), nearId);
          remember({ offerId: o.offerId, txHash });
        }
        const r = await api.rent(o.offerId, txHash);
        remember(null);
        return r;
      } catch (err) {
        // A refused payment (failed tx, wrong owner, not enough credits) is not retried as is.
        if (isFinal(err) && pending.current?.offerId === o.offerId) remember(null);
        throw err;
      }
    },
    onSuccess: (_r, o) => {
      void qc.invalidateQueries({ queryKey: qk.myRentals });
      toast.show({ tone: 'good', title: `${o.name} is yours for one match`, message: 'Pick it under Rented to field it.' });
    },
    onError: (err) =>
      toast.show({
        tone: 'critical',
        title: 'Rental not completed',
        message:
          err instanceof ApiError && err.code === 'insufficient_credits'
            ? 'Rentals are paid with paid credits. Top up on the Credits page, then rent again.'
            : err instanceof ApiError
              ? err.message
              : 'Try again.',
      }),
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
                  <AgentPortrait body={agentColour(a)} head={agentBone(a)} label={a.name} role={a.role} className={c.face} />
                  <span>{a.name}</span>
                  <small>{n > 1 ? `${n} left` : a.role}</small>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {offers.isError ? (
        <p className="sk-muted" role="alert" data-testid="s04-rent-error">
          Could not load agents to rent.{' '}
          <Button size="sm" variant="secondary" onClick={() => void offers.refetch()}>
            Retry
          </Button>
        </p>
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
                  disabled={disabled || rent.isPending || (mode !== 'dev' && o.payWith !== 'credits' && !o.ownerNearAccountId)}
                  onClick={() => rent.mutate(o)}
                  data-testid={`s04-rent-${o.offerId}`}
                >
                  {mode !== 'dev' && o.payWith === 'credits' && o.priceCredits !== undefined
                    ? `Rent · ${o.priceCredits.toLocaleString('en-US')} credits`
                    : `Rent · ${formatNear(BigInt(o.priceYocto))} NEAR`}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
