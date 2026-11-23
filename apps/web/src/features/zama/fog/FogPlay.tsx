'use client';
// One Fog Skirm game on Sepolia: the board, the sense pings, the round log, timeouts and the
// game-over reveal with "Verify this game". Chain, relayer and wallet come in as props (FogArena
// builds them), so the screen can be tested against a fake chain.
import { FOG_MAX_ROUNDS, type FogCheck, type FogOutcome, type FogSense, type FogSide } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSfx } from '@/lib/sfx';
import { encryptU8s, type TypedDataSigner } from '@/lib/zama/fhe';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { shortAddress } from '@/features/zama/credits/credits';
import { boardCells, type FogCell } from './board';
import {
  FOG_POLL_MS,
  SENSE_TEXT,
  decryptView,
  finalizePendingRound,
  isOpenSeat,
  logEntries,
  revealEndedGame,
  secondsLeft,
  sideOf,
  verifyGameOnChain,
  type FogApi,
  type FogGame,
  type FogRevealed,
  type FogView,
} from './fog';
import { FogBoard } from './FogBoard';
import s from './fog.module.css';

/** The relayer SDK calls the screen uses (encrypt, user and public decryption). */
export type FogInstance = Parameters<typeof encryptU8s>[0] & Parameters<typeof decryptView>[0] & Parameters<typeof finalizePendingRound>[1];

export interface FogDeps {
  address: string;
  contract: string;
  api: FogApi;
  signer: TypedDataSigner;
  /** Loads the relayer SDK on first use. */
  instance: () => Promise<FogInstance>;
}

export interface FogPlayProps extends FogDeps {
  gameId: bigint;
  onLeave(): void;
  pollMs?: number;
  /** How long side 1 (and spectators) wait before stepping in to publish a round side 0 has not. */
  fallbackMs?: number;
}

/** What this tab privately sensed per round (from the user-decrypted view). */
interface Ping {
  round: number;
  senseVial: FogSense;
  senseRival: FogSense;
  hit: boolean;
  carrying: boolean;
}

const pingKey = (address: string, id: bigint) => `skirm:fog:${address.toLowerCase()}:${id}`;

function loadPings(key: string): Ping[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Ping[]) : [];
  } catch {
    return [];
  }
}

function savePings(key: string, pings: Ping[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(pings));
  } catch {
    // Private mode or blocked storage: the history just does not survive a reload.
  }
}

const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function FogPlay({ gameId, address, contract, api, signer, instance, onLeave, pollMs = FOG_POLL_MS, fallbackMs = 8_000 }: FogPlayProps) {
  const sfx = useSfx();
  const [game, setGame] = useState<FogGame | null>(null);
  const [view, setView] = useState<FogView | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<FogOutcome[]>([]);
  const [pings, setPings] = useState<Ping[]>(() => loadPings(pingKey(address, gameId)));
  const [pendingMove, setPendingMove] = useState<{ round: number; dir: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<FogRevealed | null>(null);
  const [checks, setChecks] = useState<FogCheck[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const decrypting = useRef(false);
  const publishing = useRef(false);

  const side: FogSide | null = game ? sideOf(game, address) : null;

  const refresh = useCallback(async () => {
    try {
      const g = await api.read(gameId);
      setGame(g);
      return g;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, [api, gameId]);

  // Poll the header (and tick the clock).
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, pollMs);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [refresh, pollMs]);

  // New public outcomes: fetch them and play the round's sound.
  const roundsPlayed = game?.roundsPlayed ?? 0;
  useEffect(() => {
    if (roundsPlayed <= outcomes.length) return;
    let live = true;
    void api.outcomes(gameId, roundsPlayed).then(
      (o) => {
        if (!live) return;
        setOutcomes(o);
        const last = o[o.length - 1];
        if (last && o.length > outcomes.length) sfx.play(last.winner !== 0 ? (side !== null && last.winner === side + 1 ? 'good' : 'bad') : last.trapHit ? 'bad' : 'radio');
      },
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new round
  }, [api, gameId, roundsPlayed]);

  // Decrypt my view once per round (one wallet signature per session, cached by lib/zama/fhe).
  const wantKey = game && side !== null && (game.status === 'playing' || game.status === 'ended') ? `${game.roundsPlayed}:${game.status}` : null;
  const decryptNow = useCallback(async () => {
    if (!game || side === null || decrypting.current) return;
    decrypting.current = true;
    try {
      const inst = await instance();
      const v = await decryptView(inst, signer, contract, await api.playerView(gameId, side));
      setView(v);
      setViewKey(`${game.roundsPlayed}:${game.status}`);
      setPings((prev) => {
        const round = game.roundsPlayed;
        if (prev.some((p) => p.round === round)) return prev;
        const next = [...prev, { round, senseVial: v.senseVial, senseRival: v.senseRival, hit: v.hit, carrying: v.carrying }];
        savePings(pingKey(address, gameId), next);
        return next;
      });
      if (game.roundsPlayed > 0) sfx.play(v.hit ? 'bad' : v.senseRival === 0 || v.senseVial === 0 ? 'blip' : 'tick');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      decrypting.current = false;
    }
  }, [address, api, contract, game, gameId, instance, side, signer, sfx]);

  useEffect(() => {
    if (wantKey && wantKey !== viewKey && !error) void decryptNow();
  }, [wantKey, viewKey, error, decryptNow]);

  // Publish a resolved round (side 0 at once, others after a grace period), then the final board.
  const awaiting = !!game?.awaitingReveal && game.status === 'playing';
  const ended = game?.status === 'ended';
  const revealedOnChain = !!game?.revealed;
  useEffect(() => {
    if (!awaiting && !(ended && !revealed)) return;
    const delay = side === 0 ? 0 : fallbackMs;
    const t = setTimeout(async () => {
      if (publishing.current) return;
      publishing.current = true;
      try {
        const inst = await instance();
        if (awaiting) await finalizePendingRound(api, inst, gameId);
        else setRevealed(await revealEndedGame(api, inst, gameId));
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        publishing.current = false;
      }
    }, delay);
    return () => clearTimeout(t);
  }, [awaiting, ended, revealed, revealedOnChain, side, fallbackMs, api, gameId, instance, refresh]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const round = game?.round ?? 0;
  const myMoved = !!game && side !== null && game.moved[side];
  const rivalMoved = !!game && side !== null && game.moved[(1 - side) as FogSide];
  const canMove = !!game && game.status === 'playing' && !game.awaitingReveal && side !== null && !myMoved && !!view && !busy;
  const sealed = pendingMove && pendingMove.round === round && myMoved ? pendingMove.dir : null;

  const move = (cell: FogCell) => {
    if (cell.move === null || side === null) return;
    sfx.play('click');
    void act('move', async () => {
      const inst = await instance();
      const enc = await encryptU8s(inst, contract, address, [cell.move!]);
      await api.move(gameId, enc);
      setPendingMove({ round, dir: cell.move! });
    });
  };

  const cells = useMemo(
    () => (side === null ? [] : boardCells({ side, view, canMove, pendingMove: sealed, revealed })),
    [side, view, canMove, sealed, revealed],
  );
  const log = useMemo(() => logEntries(outcomes, side), [outcomes, side]);
  const left = game ? secondsLeft(game.deadline, now) : 0;
  const latestPing = pings.find((p) => p.round === roundsPlayed) ?? null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/fog?game=${gameId}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!game) {
    return (
      <section className={`sk-panel ${s.panel}`} data-testid="fog-loading">
        <p className={s.note}>{error ?? `Reading game #${gameId} from Sepolia…`}</p>
        {error ? (
          <Button size="sm" onClick={onLeave}>
            Back to the lobby
          </Button>
        ) : null}
      </section>
    );
  }

  if (game.status === 'none' || game.status === 'cancelled') {
    return (
      <section className={`sk-panel ${s.panel}`} data-testid="fog-missing">
        <p className={s.note}>{game.status === 'none' ? `There is no game #${gameId} on FogSkirm.` : `Game #${gameId} was called off before anyone joined.`}</p>
        <Button size="sm" onClick={onLeave}>
          Back to the lobby
        </Button>
      </section>
    );
  }

  if (game.status === 'waiting') {
    const mine = side === 0;
    return (
      <section className={`sk-panel ${s.panel}`} data-testid="fog-waiting">
        <span className="sk-kick">Game #{String(gameId)} · waiting for a rival</span>
        <p className={s.lead}>
          {mine
            ? 'Your two flood switches are planted and sealed. Send the game id to your rival: the vial is drawn the moment they join.'
            : 'This game is open. Join it from the lobby with its id.'}
        </p>
        {!isOpenSeat(game.players[1]) ? <p className={s.note}>Invited: {shortAddress(game.players[1])}</p> : null}
        <div className={s.row}>
          <Button size="sm" variant="primary" onClick={copyLink} data-testid="fog-copy">
            {copied ? 'Link copied' : `Copy link to game #${gameId}`}
          </Button>
          {mine ? (
            <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={() => void act('cancel', () => api.cancel(gameId))}>
              Call it off
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onLeave}>
            Lobby
          </Button>
        </div>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
      </section>
    );
  }

  const status = (() => {
    if (game.status === 'ended') return null;
    if (side === null) return 'You are watching. Only the two players can see through their own fog.';
    if (game.awaitingReveal) return 'Both moves are in. The round was resolved under FHE; publishing its public outcome with the KMS proof…';
    if (busy === 'move') return 'Encrypting your move in this tab and sealing it on chain (confirm in your wallet)…';
    if (!view) return 'Decrypting your scout (sign once in your wallet: only you can read it)…';
    if (myMoved) return rivalMoved ? 'Resolving…' : 'Your move is sealed. Waiting for the rival to move through the fog…';
    return rivalMoved ? 'Your rival has moved. Click a glowing tile next to your scout.' : 'Your move: click a glowing tile next to your scout.';
  })();

  const timedOut = game.status === 'playing' && !game.awaitingReveal && left === 0;
  const result = (() => {
    if (game.status !== 'ended') return null;
    const how = game.endReason === 'timeout' ? ' (timeout)' : game.endReason === 'max_rounds' ? ` after ${FOG_MAX_ROUNDS} rounds` : '';
    if (game.winner === 0) return `Draw${how}.`;
    if (side === null) return `Side ${game.winner} wins${how}.`;
    return game.winner === side + 1 ? `You win${how}! The seed vial made it home.` : `Your rival wins${how}.`;
  })();

  return (
    <div className={s.play} data-testid="fog-play">
      <section className={`sk-panel ${s.boardPanel}`}>
        <div className={s.head}>
          <span className="sk-kick">
            Game #{String(gameId)} · round {Math.min(round, FOG_MAX_ROUNDS)}/{FOG_MAX_ROUNDS}
          </span>
          {game.status === 'playing' && !game.awaitingReveal ? (
            <span className={`sk-mono ${left < 60 ? s.hot : ''}`} role="timer" aria-label={`${left} seconds left to move`}>
              {fmtClock(left)}
            </span>
          ) : null}
        </div>
        {side !== null ? (
          <FogBoard
            cells={cells}
            mode={game.status === 'ended' ? 'reveal' : 'play'}
            onPick={move}
            busy={!!busy}
            carrying={!!view?.carrying}
            pulseKey={roundsPlayed}
            label={game.status === 'ended' ? 'The revealed board' : 'Your view of the board'}
          />
        ) : null}
        <p className={s.legend}>
          <span>
            <i className={`${s.key} ${s.keyMine}`} /> your scout
          </span>
          <span>
            <i className={`${s.key} ${s.keyTrap}`} /> your flood switch
          </span>
          <span>
            <i className={`${s.key} ${s.keyVial}`} /> vial row
          </span>
          {revealed ? (
            <>
              <span>
                <i className={`${s.key} ${s.keyRival}`} /> rival
              </span>
              <span>⚗ vial</span>
            </>
          ) : null}
        </p>
      </section>

      <aside className={s.side}>
        {result ? (
          <section className={`sk-panel ${s.panel} ${s.result}`} data-testid="fog-result">
            <span className="sk-kick">Game over</span>
            <p className={`sk-disp ${s.resultText}`}>{result}</p>
            <p className={s.note}>
              {revealed
                ? 'The fog has lifted: every trap, the vial and every move are public now, checked on chain against the KMS proof.'
                : 'Lifting the fog: every hidden value is being decrypted publicly and checked on chain…'}
            </p>
            <div className={s.row}>
              <Button
                size="sm"
                variant="primary"
                disabled={!revealedOnChain}
                loading={busy === 'verify'}
                data-testid="fog-verify"
                onClick={() =>
                  void act('verify', async () => {
                    const v = await verifyGameOnChain(api, gameId);
                    setRevealed(v.revealed);
                    setChecks(v.checks);
                    sfx.play(v.checks.every((c) => c.ok) ? 'good' : 'bad');
                  })
                }
              >
                Verify this game
              </Button>
              <Button size="sm" variant="ghost" onClick={onLeave}>
                New game
              </Button>
            </div>
            {checks ? (
              <ul className={s.checks} data-testid="fog-checks">
                {checks.map((c) => (
                  <li key={c.id} className={c.ok ? s.ok : s.bad}>
                    <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> <strong>{c.label}</strong> <span className={s.note}>{c.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {status ? (
          <section className={`sk-panel ${s.panel}`} aria-live="polite">
            <p className={s.lead} data-testid="fog-status">
              {status}
            </p>
            {timedOut && side !== null ? (
              myMoved || !rivalMoved ? (
                <Button size="sm" variant="primary" loading={busy === 'timeout'} onClick={() => void act('timeout', () => api.claimTimeout(gameId))} data-testid="fog-claim">
                  {myMoved ? 'Rival timed out: claim the win' : 'Nobody moved: end as a draw'}
                </Button>
              ) : (
                <p className={s.warn}>You ran out of time; your rival can claim the win.</p>
              )
            ) : null}
          </section>
        ) : null}

        {side !== null && view ? (
          <section className={`sk-panel ${s.panel}`} data-testid="fog-sense">
            <span className="sk-kick">Sense · only you can decrypt this</span>
            <ul className={s.senses}>
              <li key={`v${roundsPlayed}`} className={s.ping}>
                <span aria-hidden="true">{view.carrying ? '⚗' : SENSE_TEXT[view.senseVial].icon}</span>
                {view.carrying ? 'You carry the seed vial: get it to your home row!' : `Vial: ${SENSE_TEXT[view.senseVial].label}`}
              </li>
              <li key={`r${roundsPlayed}`} className={s.ping}>
                <span aria-hidden="true">{SENSE_TEXT[view.senseRival].icon}</span>
                Rival scout: {SENSE_TEXT[view.senseRival].label}
              </li>
              {latestPing?.hit ? <li className={s.bad}>💧 You hit a flood switch and were washed home.</li> : null}
            </ul>
            <p className={s.note}>🟢 on or next to you · 🟡 2–3 steps · ⚪ 4 or more. Steps are counted along rows and columns.</p>
          </section>
        ) : null}

        <section className={`sk-panel ${s.panel}`} data-testid="fog-log">
          <span className="sk-kick">Round log · public, KMS-verified</span>
          {log.length === 0 ? <p className={s.note}>Nothing has surfaced yet.</p> : null}
          <ol className={s.log}>
            {log.map((e) => {
              const ping = pings.find((p) => p.round === e.round);
              return (
                <li key={e.round} className={s[`tone_${e.tone}`]}>
                  <span className="sk-mono">R{e.round}</span> {e.text}
                  {ping ? (
                    <span className={s.myPing}>
                      {' '}
                      · you sensed vial {SENSE_TEXT[ping.senseVial].icon} rival {SENSE_TEXT[ping.senseRival].icon}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
        {error ? (
          <p className={s.error} role="alert">
            {error}{' '}
            <button type="button" className={s.linkish} onClick={() => setError(null)}>
              Retry
            </button>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
