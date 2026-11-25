'use client';
// "🎲 Seed drawn on-chain (FHE)" and the sealed supply drops of a Zama match (NEXT_PUBLIC_ZAMA_ENABLED).
//
// Live: a small card over the HUD. The seed chip links to the reveal transaction; the next drop
// reads "🔒 next drop: encrypted" until its value is revealed on chain, then the tile it lands on.
// A player's tab with its EVM wallet already connected (it sealed the loadout) sends the drop reveal
// transactions as each comes due (team A first, team B as fallback); the server only reads them.
// Debrief: the same record, read from the chain, with every value and its transaction, and a button
// that publishes the draws the map did not use, so all of the match's randomness ends up public.
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState } from 'react';
import type { Team } from '@/lib/realtime/protocol';
import { getFhevmInstance } from '@/lib/zama/relayer';
import { connectEvmWallet, restoreEvmWallet } from '@/lib/zama/wallet';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { matchAddress, sealedMatchKey } from '@/features/zama/sealed/sealed';
import {
  DROP_SLOTS,
  driveDropReveals,
  dropTileOf,
  explorerUrl,
  isDrawn,
  mapDropCount,
  randomnessApi,
  readOnlyRunner,
  shortSeed,
  type ChainRandomness,
  type DropAction,
  type RandomnessApi,
  type RevealTxs,
} from './randomness';
import s from './randomness.module.css';
import { SealBadge, WhoCanSee } from '@/features/zama/privacy/WhoCanSee';

export interface ChainRandomnessProps {
  matchId: string;
  mapId: string;
  /** The player's side; null when watching (it only reads). */
  team: Team | null;
  mode: 'live' | 'debrief';
  /** The seed the server announced at the start (v2_start `zama`), shown before the chain read lands. */
  seed?: string | null;
  /** Tests: the chain reads (default: SkirmMatch over the public Sepolia RPC). */
  api?: RandomnessApi;
}

/** How often the live card re-reads the chain. */
export const LIVE_POLL_MS = 5_000;

const STEP: Record<DropAction['kind'], string> = {
  reveal: 'Opening the drop on chain (confirm in your wallet)…',
  finalize: 'Checking the drop’s decryption proof on chain…',
  wait: '',
  done: '',
};

function contractOrNull(): string | null {
  try {
    return matchAddress();
  } catch {
    return null;
  }
}

export function ChainRandomness({ matchId, mapId, team, mode, seed: announced, api: injected }: ChainRandomnessProps) {
  const contract = contractOrNull();
  const key = sealedMatchKey(matchId);
  const reader = useRef<RandomnessApi | null>(null);
  if (!reader.current && contract) reader.current = injected ?? randomnessApi(readOnlyRunner(), contract);
  const [rnd, setRnd] = useState<ChainRandomness | null>(null);
  const [txs, setTxs] = useState<RevealTxs | null>(null);
  const [step, setStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const live = mode === 'live';
  const used = mapDropCount(mapId);

  // Read the chain: once for the debrief, every LIVE_POLL_MS while live.
  useEffect(() => {
    const api = reader.current;
    if (!api) return;
    let gone = false;
    const read = () =>
      api
        .read(key)
        .then((r) => !gone && setRnd(r))
        .catch(() => undefined);
    void read();
    if (!live) return () => void (gone = true);
    const t = setInterval(read, LIVE_POLL_MS);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [key, live]);

  // The reveal transactions, looked up again whenever another value is published.
  const revealedCount = rnd?.seed ? 1 + rnd.dropsRevealed : 0;
  useEffect(() => {
    const api = reader.current;
    if (!api || !revealedCount) return;
    let gone = false;
    api
      .txs(key)
      .then((t) => !gone && setTxs(t))
      .catch(() => undefined);
    return () => void (gone = true);
  }, [key, revealedCount]);

  // A player's live tab with its wallet already connected sends the drop reveals as they come due.
  useEffect(() => {
    if (!live || !team || !contract || !used) return;
    const ctl = new AbortController();
    void (async () => {
      const conn = await restoreEvmWallet().catch(() => null);
      if (!conn || ctl.signal.aborted) return;
      const instance = await getFhevmInstance(conn.eip1193);
      await driveDropReveals({
        api: injected ?? randomnessApi(conn.signer, contract),
        instance,
        key,
        team,
        slots: used,
        signal: ctl.signal,
        onUpdate: (r, a) => {
          setRnd(r);
          setStep(STEP[a.kind]);
        },
      });
      setStep('');
    })().catch((e: unknown) => {
      if (!ctl.signal.aborted) setError(errorMessage(e));
    });
    return () => ctl.abort();
  }, [live, team, contract, used, key, injected]);

  if (!contract) return null;
  const drawn = rnd ? isDrawn(rnd) : live;
  if (!drawn) return null;
  const seed = rnd?.seed ?? announced ?? null;
  const slots = live ? used : DROP_SLOTS;
  const firstSealed = rnd ? rnd.dropsRevealed : 0;
  const seedLink = explorerUrl(txs?.seed ?? null, contract);

  const publishRest = async () => {
    setPublishing(true);
    setError(null);
    try {
      const conn = await connectEvmWallet();
      const instance = await getFhevmInstance(conn.eip1193);
      const r = await driveDropReveals({
        api: injected ?? randomnessApi(conn.signer, contract),
        instance,
        key,
        team: null,
        slots: DROP_SLOTS,
        onUpdate: (x, a) => {
          setRnd(x);
          setStep(STEP[a.kind] || (a.kind === 'wait' ? 'Waiting until the next draw may open…' : ''));
        },
      });
      setRnd(r);
      setStep('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className={`sk-panel ${s.card} ${live ? s.live : ''}`} data-testid="zama-randomness">
      {live ? null : <span className="sk-kick">On-chain randomness · Sepolia</span>}
      <p className={s.seedRow}>
        <span className={s.chip} title={seed ? `Match seed ${seed}` : 'The seed is drawn, not revealed yet'} data-testid="zama-seed-chip">
          🎲 Seed drawn on-chain (FHE){seed ? <span className={s.mono}> · {shortSeed(seed)}</span> : null}
        </span>
        {seed && seedLink ? (
          <a className={s.link} href={seedLink} target="_blank" rel="noreferrer" data-testid="zama-seed-tx">
            reveal tx ↗
          </a>
        ) : null}
      </p>
      {slots ? (
        <ul className={s.drops}>
          {Array.from({ length: slots }, (_, k) => {
            const value = rnd?.drops[k] ?? null;
            const tile = value !== null ? dropTileOf(mapId, value) : null;
            const link = value !== null ? explorerUrl(txs?.drops[k] ?? null, contract) : null;
            const unused = k >= used;
            return (
              <li key={k} data-testid={`zama-drop-${k}`}>
                {value !== null ? (
                  <>
                    <span>
                      📦 {unused ? `Draw ${k + 1} (unused)` : `Drop ${k + 1}`}
                      {!unused && tile ? <span className={s.mono}> · tile {tile.join(',')}</span> : null}
                      <span className={s.muted}> · value {value}</span>
                    </span>
                    {link ? (
                      <a className={s.link} href={link} target="_blank" rel="noreferrer">
                        tx ↗
                      </a>
                    ) : null}
                  </>
                ) : (
                  <SealBadge state="sealed">{k === firstSealed ? (unused ? 'next draw' : 'next drop') : unused ? 'draw' : 'drop'}: encrypted</SealBadge>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={s.muted}>This map has no supply drops.</p>
      )}
      <WhoCanSee topic="randomness" />
      {step ? <p className={s.muted}>{step}</p> : null}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {!live && rnd?.startedAt && rnd.dropsRevealed < DROP_SLOTS ? (
        <Button variant="secondary" size="sm" onClick={() => void publishRest()} disabled={publishing} data-testid="zama-publish-draws">
          Publish the remaining draws
        </Button>
      ) : null}
    </div>
  );
}
