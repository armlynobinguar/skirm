'use client';
// The live "Predict 🔒" panel over a spectated match (NEXT_PUBLIC_ZAMA_ENABLED).
//
// While betting is open the page shows only "N sealed predictions · pool hidden until tick 30": the
// side and the amount are encrypted in this tab before they leave the browser, so nobody (players,
// other spectators, the server) can see how the pool splits, herd behind it or front-run it. At the
// close tick the server opens the two totals with a KMS proof: then the pool and the odds show. The
// caller can user-decrypt its own prediction at any time. Renders nothing when the match has no market.
import { Button, TextField } from '@skirm/ui';
import { PREDICTION_CLOSE_TICK } from '@skirm/shared';
import { useEffect, useRef, useState } from 'react';
import { zamaConfig } from '@/lib/zama/config';
import { formatUnits6, isZeroHandle } from '@/lib/zama/fhe';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { explorerUrl, readOnlyRunner } from '@/features/zama/randomness/randomness';
import { approveOperator, parseCskirm } from '@/features/zama/stakes/stakes';
import {
  PREDICTION_POLL_MS,
  encryptPrediction,
  marketOdds,
  marketPhase,
  oddsLabel,
  predictionsApi,
  revealMine,
  sealedPredictionsLabel,
  type ChainMarket,
  type PredictionsApi,
  type RevealedPrediction,
} from './predictions';
import s from './predictions.module.css';
import { SealBadge, WhoCanSee } from '@/features/zama/privacy/WhoCanSee';

export interface PredictPanelProps {
  matchId: string;
  /** The match tick on screen (betting stops at PREDICTION_CLOSE_TICK). */
  tick: number;
  /** Crew names, when known. */
  names?: { A: string; B: string };
  /** Tests: the chain (default: MatchPredictions over the public Sepolia RPC for reads, the wallet for writes). */
  api?: PredictionsApi;
  /** Tests: the contract address. */
  contract?: string;
  /** Tests: a fixed wallet address instead of the injected wallet's. */
  address?: string | null;
}

type Busy = 'predict' | 'reveal' | null;

export function PredictPanel({ matchId, tick, names, api: injected, contract: fixedContract, address: fixedAddress }: PredictPanelProps) {
  const contract = fixedContract ?? zamaConfig.contracts.predictions ?? '';
  const reader = useRef<PredictionsApi | null>(null);
  if (!reader.current) reader.current = injected ?? predictionsApi(readOnlyRunner(), contract);
  const [market, setMarket] = useState<ChainMarket | null>(null);
  const [address, setAddress] = useState<string | null>(fixedAddress ?? null);
  const [hasPrediction, setHasPrediction] = useState(false);
  const [mine, setMine] = useState<RevealedPrediction | null>(null);
  const [team, setTeam] = useState<'A' | 'B'>('A');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
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

  // The market, re-read until it is resolved or void.
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
          if (!gone) setHasPrediction(!isZeroHandle(p.stake));
        }
      } catch {
        // RPC hiccup: the next poll retries.
      }
    };
    void read();
    const poll = settled ? null : setInterval(() => void read(), PREDICTION_POLL_MS);
    return () => {
      gone = true;
      if (poll) clearInterval(poll);
    };
  }, [matchId, address, settled]);

  const phase = marketPhase(market, tick, Math.floor(Date.now() / 1000));
  if (!market || phase === 'none') return null;
  const amountBase = parseCskirm(amount);

  const run = async (kind: Exclude<Busy, null>, fn: (ctx: { api: PredictionsApi; me: string; instance: Awaited<ReturnType<typeof getFhevmInstance>>; signer: Awaited<ReturnType<typeof connectEvmWallet>>['signer'] }) => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      const conn = await connectEvmWallet();
      const me = conn.address.toLowerCase();
      setAddress(me);
      const instance = await getFhevmInstance(conn.eip1193);
      await fn({ api: injected ?? predictionsApi(conn.signer, contract), me, instance, signer: conn.signer });
      const api = reader.current!;
      setMarket(await api.get(matchId));
      setHasPrediction(!isZeroHandle((await api.mine(matchId, me)).stake));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const predict = () =>
    run('predict', async ({ api, me, instance, signer }) => {
      if (amountBase === null || amountBase === 0n) throw new Error('Enter an amount in cSKIRM, e.g. 10.');
      const credits = zamaConfig.contracts.credits;
      if (!credits) throw new Error('cSKIRM is not deployed yet.');
      // One-time: MatchPredictions may pull cSKIRM, but only on a prediction this wallet signs.
      await approveOperator(signer, credits, me, contract);
      const enc = await encryptPrediction(instance, contract, me, team, amountBase);
      setTx(await api.predict(matchId, enc));
      setAmount('');
    });

  const reveal = () =>
    run('reveal', async ({ api, me, instance, signer }) => {
      setMine(await revealMine(instance, signer, contract, await api.mine(matchId, me)));
    });

  const odds = marketOdds(market);
  const txLink = tx ? explorerUrl(tx as `0x${string}`) : null;
  const revealed = phase === 'revealed' || phase === 'resolved' || (phase === 'void' && market.totalA + market.totalB > 0n);

  return (
    <div className={`sk-panel ${s.live}`} data-testid="zama-predict-panel">
      <div className={s.head}>
        <span className={s.title}>
          Predict <SealBadge state="sealed">sealed</SealBadge>
        </span>
        <span className={s.muted} data-testid="zama-predict-count">
          {sealedPredictionsLabel(market.predictors)}
        </span>
      </div>
      <WhoCanSee topic="predictions" />

      {phase === 'open' ? (
        <>
          <p className={s.muted} data-testid="zama-predict-hidden">
            Pool hidden until tick {PREDICTION_CLOSE_TICK} · side and amount encrypted
          </p>
          {hasPrediction ? null : (
            <>
              <div className={s.sides} role="radiogroup" aria-label="Back a crew">
                {(['A', 'B'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={team === t}
                    className={team === t ? s.sideOn : s.side}
                    onClick={() => setTeam(t)}
                    data-testid={`zama-predict-side-${t}`}
                  >
                    {label(t)}
                  </button>
                ))}
              </div>
              <div className={s.row}>
                <TextField
                  label="Stake"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  suffix="cSKIRM"
                  mono
                  inputMode="decimal"
                  placeholder="10"
                  {...(amount && amountBase === null ? { error: 'Up to 6 decimals' } : {})}
                  data-testid="zama-predict-amount"
                />
                <Button variant="primary" size="sm" onClick={() => void predict()} disabled={busy !== null || !amountBase} data-testid="zama-predict-submit">
                  {busy === 'predict' ? 'Encrypting…' : 'Predict 🔒'}
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}

      {phase === 'closing' ? <p className={s.muted}>Betting closed at tick {PREDICTION_CLOSE_TICK} · revealing the pool…</p> : null}

      {revealed ? (
        <dl className={s.pool} data-testid="zama-predict-pool">
          {(['A', 'B'] as const).map((t) => (
            <div key={t} className={market.status === 'resolved' && market.winner === (t === 'A' ? 0 : 1) ? s.winner : undefined}>
              <dt>{label(t)}</dt>
              <dd>
                {formatUnits6(t === 'A' ? market.totalA : market.totalB)} cSKIRM · {oddsLabel(odds[t])}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {phase === 'void' ? <p className={s.muted}>Market void · every stake is refunded</p> : null}

      {hasPrediction ? (
        mine ? (
          <p className={s.result} data-testid="zama-predict-mine">
            You backed {label(mine.team)} with {formatUnits6(mine.stake)} cSKIRM <span className={s.muted}>· only you can see this</span>
          </p>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => void reveal()} disabled={busy !== null} data-testid="zama-predict-reveal">
            Your prediction: 🔒 Reveal
          </Button>
        )
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
    </div>
  );
}
