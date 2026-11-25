'use client';
// The debrief's "Claim 🔒" for a spectator prediction (NEXT_PUBLIC_ZAMA_ENABLED). Shows the market's
// public outcome (the two totals and the winner), and for the connected wallet's own prediction a
// claim: the contract pays `stake + stake × losing / winning − fee` to a winner and an encrypted 0 to
// a loser, so the payout is a ciphertext only the claimant decrypts here. Renders nothing when the
// match had no market or the wallet did not predict.
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import { zamaConfig } from '@/lib/zama/config';
import { formatUnits6, isZeroHandle } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { explorerUrl, readOnlyRunner } from '@/features/zama/randomness/randomness';
import { marketOdds, oddsLabel, predictionsApi, revealMine, type ChainMarket, type MyPrediction, type PredictionsApi, type RevealedPrediction } from './predictions';
import s from './predictions.module.css';
import { SealBadge, WhoCanSee } from '@/features/zama/privacy/WhoCanSee';

export interface PredictionClaimProps {
  matchId: string;
  names?: { A: string; B: string };
  /** Tests: the chain. */
  api?: PredictionsApi;
  contract?: string;
  address?: string | null;
}

export function PredictionClaim({ matchId, names, api: injected, contract: fixedContract, address: fixedAddress }: PredictionClaimProps) {
  const contract = fixedContract ?? zamaConfig.contracts.predictions ?? '';
  const reader = useRef<PredictionsApi | null>(null);
  if (!reader.current) reader.current = injected ?? predictionsApi(readOnlyRunner(), contract);
  const [market, setMarket] = useState<ChainMarket | null>(null);
  const [address, setAddress] = useState<string | null>(fixedAddress ?? null);
  const [mineH, setMineH] = useState<MyPrediction | null>(null);
  const [mine, setMine] = useState<RevealedPrediction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const label = (t: 'A' | 'B') => names?.[t] ?? `Crew ${t}`;

  useEffect(() => {
    if (fixedAddress !== undefined) return;
    let gone = false;
    void restoreEvmWallet()
      .then((c) => !gone && setAddress(c?.address.toLowerCase() ?? null))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [fixedAddress]);

  // Re-read until the market is resolved or void (the server resolves it right after the match).
  const settled = market?.status === 'resolved' || market?.status === 'void';
  useEffect(() => {
    const api = reader.current!;
    let gone = false;
    const read = async () => {
      try {
        const m = await api.get(matchId);
        if (gone) return;
        setMarket(m);
        if (address) {
          const p = await api.mine(matchId, address);
          if (!gone) setMineH(p);
        }
      } catch {
        // RPC hiccup: the next poll retries.
      }
    };
    void read();
    const poll = settled ? null : setInterval(() => void read(), 8_000);
    return () => {
      gone = true;
      if (poll) clearInterval(poll);
    };
  }, [matchId, address, settled]);

  if (!market || market.status === 'none' || !mineH || isZeroHandle(mineH.stake)) return null;

  /** Claims (if not yet), then decrypts side, stake and payout. */
  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const conn = await connectEvmWallet();
      const me = conn.address.toLowerCase();
      setAddress(me);
      const instance = await getFhevmInstance(conn.eip1193);
      const api = injected ?? predictionsApi(conn.signer, contract);
      let h = await reader.current!.mine(matchId, me);
      if (!h.claimed) {
        setTx(await api.claim(matchId));
        h = await reader.current!.mine(matchId, me);
      }
      setMineH(h);
      setMine(await revealMine(instance, conn.signer, contract, h));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const odds = marketOdds(market);
  const open = market.status === 'resolved' || market.status === 'void';
  const txLink = tx ? explorerUrl(tx as `0x${string}`) : null;
  const winner = market.status === 'resolved' ? (market.winner === 0 ? 'A' : 'B') : null;

  return (
    <section className={`sk-panel ${s.card}`} data-testid="zama-prediction-claim">
      <div className={s.head}>
        <span className={s.title}>
          Your prediction <SealBadge state="sealed">sealed</SealBadge>
        </span>
        <span className={s.muted}>{market.predictors} sealed</span>
      </div>
      <WhoCanSee topic="predictions" />
      {market.totalA + market.totalB > 0n ? (
        <dl className={s.pool}>
          {(['A', 'B'] as const).map((t) => (
            <div key={t} className={winner === t ? s.winner : undefined}>
              <dt>{label(t)}</dt>
              <dd>
                {formatUnits6(t === 'A' ? market.totalA : market.totalB)} cSKIRM · {oddsLabel(odds[t])}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {market.status === 'void' ? <p className={s.muted}>Market void (draw, no winner backed, or no result) · your stake comes back in full</p> : null}
      {!open ? <p className={s.muted}>Waiting for the market to resolve…</p> : null}

      {mine ? (
        <p className={s.result} data-testid="zama-prediction-payout">
          You backed {label(mine.team)} with {formatUnits6(mine.stake)} cSKIRM ·{' '}
          {mine.payout === null ? 'not claimed' : mine.payout > 0n ? <span className={s.good}>paid {formatUnits6(mine.payout)} cSKIRM</span> : 'paid 0'}
          <span className={s.muted}> · only you can see this</span>
        </p>
      ) : open ? (
        <Button variant="primary" size="sm" onClick={() => void claim()} disabled={busy} data-testid="zama-prediction-claim-btn">
          {busy ? 'Claiming…' : mineH.claimed ? 'Payout: 🔒 Reveal' : 'Claim 🔒'}
        </Button>
      ) : null}

      {txLink ? (
        <a className={s.link} href={txLink} target="_blank" rel="noreferrer">
          Transaction ↗
        </a>
      ) : null}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
