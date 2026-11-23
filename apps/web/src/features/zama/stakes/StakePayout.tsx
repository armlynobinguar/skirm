'use client';
// "Stakes · Sepolia" in the debrief of a sealed match (NEXT_PUBLIC_ZAMA_ENABLED).
//
// Public: whether each side's stake counted (the only thing the chain reveals about it) and the
// settlement, with a "Settled on Sepolia" link to the transaction that anchored the match log hash
// and paid the escrow out. Private: "Payout: 🔒 Reveal" user-decrypts the player's own stake and
// payout in this tab (only that wallet holds ACL access), showing what the match won or cost.
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import type { Team } from '@/lib/realtime/protocol';
import { formatUnits6 } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { explorerUrl, readOnlyRunner } from '@/features/zama/randomness/randomness';
import { matchAddress, sealedMatchKey, sideOf } from '@/features/zama/sealed/sealed';
import { revealPayout, stakesApi, type ChainEscrow, type ChainSettlement, type Payout, type StakesApi } from './stakes';
import s from './stakes.module.css';

export interface StakePayoutProps {
  matchId: string;
  /** The player's side; null when watching (no payout to reveal). */
  team: Team | null;
  /** Tests: the chain reads (default: SkirmMatch over the public Sepolia RPC). */
  api?: StakesApi;
}

/** How often the card re-reads the chain until the server's settlement lands. */
export const SETTLE_POLL_MS = 8_000;

function contractOrNull(): string | null {
  try {
    return matchAddress();
  } catch {
    return null;
  }
}

const signed = (v: bigint) => `${v > 0n ? '+' : ''}${formatUnits6(v)}`;

export function StakePayout({ matchId, team, api: injected }: StakePayoutProps) {
  const contract = contractOrNull();
  const key = sealedMatchKey(matchId);
  const reader = useRef<StakesApi | null>(null);
  if (!reader.current && contract) reader.current = injected ?? stakesApi(readOnlyRunner(), contract);
  const [escrow, setEscrow] = useState<ChainEscrow | null>(null);
  const [settled, setSettled] = useState<ChainSettlement | null>(null);
  const [payout, setPayout] = useState<Payout | 'unpaid' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read once, then poll until the settlement shows up (the server settles after v2_end).
  const done = !!settled?.logHash;
  useEffect(() => {
    const api = reader.current;
    if (!api || done) return;
    let gone = false;
    const read = () =>
      Promise.all([api.escrow(key), api.settlement(key)])
        .then(([e, st]) => {
          if (gone) return;
          setEscrow(e);
          setSettled(st);
        })
        .catch(() => undefined);
    void read();
    const t = setInterval(read, SETTLE_POLL_MS);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [key, done]);

  if (!contract || !escrow) return null;
  const staked = escrow.minStake > 0n;
  if (!staked && !settled?.logHash) return null;
  const mine = team ? sideOf(team) : null;
  const link = settled?.logHash ? explorerUrl(settled.txHash, contract) : null;

  const reveal = async () => {
    if (mine === null) return;
    setBusy(true);
    setError(null);
    try {
      const conn = await connectEvmWallet();
      const instance = await getFhevmInstance(conn.eip1193);
      // Re-read: the payout handle appears with the settlement.
      const fresh = await (reader.current ?? stakesApi(conn.signer, contract)).escrow(key);
      setEscrow(fresh);
      const p = await revealPayout(instance, conn.signer, contract, fresh, mine);
      setPayout(p ?? 'unpaid');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`sk-panel ${s.card}`} data-testid="zama-stakes">
      <span className="sk-kick">{staked ? 'Stakes · Sepolia' : 'Settlement · Sepolia'}</span>
      {staked ? (
        <>
          <p className={s.muted}>
            Minimum {formatUnits6(escrow.minStake)} cSKIRM per side · amounts stay encrypted{escrow.feeBps ? ` · fee ${escrow.feeBps / 100}% of the pot` : ''}
          </p>
          <ul className={s.rows}>
            {(['A', 'B'] as const).map((t) => {
              const ok = escrow.stakeOk[sideOf(t)];
              return (
                <li key={t} data-testid={`zama-stake-ok-${t}`}>
                  <span>{team === t ? 'You' : team ? 'Rival' : `Team ${t}`}</span>
                  <span className={ok ? s.ok : s.bad}>{ok ? '🔒 stake counted' : '🔒 stake did not count'}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {link ? (
        <p className={s.muted}>
          <a className={s.link} href={link} target="_blank" rel="noreferrer" data-testid="zama-settled-link">
            ✓ Settled on Sepolia ↗
          </a>
          <span> · log hash anchored · {settled?.winner === 'draw' ? 'draw' : `team ${settled?.winner} won`}</span>
        </p>
      ) : (
        <p className={s.muted} data-testid="zama-settle-pending">
          Waiting for the game server to settle on Sepolia…
        </p>
      )}
      {staked && mine !== null ? (
        payout && payout !== 'unpaid' ? (
          <p className={s.payout} data-testid="zama-payout">
            Payout: {signed(payout.net)} cSKIRM
            <span className={s.muted}>
              {' '}
              · staked {formatUnits6(payout.staked)}, paid back {formatUnits6(payout.paid)}
            </span>
          </p>
        ) : (
          <>
            {payout === 'unpaid' ? <p className={s.muted}>Nothing paid out yet: reveal again once the match is settled.</p> : null}
            <Button variant="secondary" size="sm" onClick={() => void reveal()} disabled={busy} data-testid="zama-payout-reveal">
              Payout: 🔒 Reveal
            </Button>
          </>
        )
      ) : null}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
