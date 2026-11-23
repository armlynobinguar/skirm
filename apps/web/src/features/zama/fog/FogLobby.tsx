'use client';
// The Fog Skirm lobby: create a game (plant your two flood switches, pick the move clock, optionally
// invite one address) or join one by its id (plant yours, which draws the hidden vial and starts
// round 1). Traps are encrypted in this tab with one proof; the chain never sees them in the clear.
import { fogTrapBand, type FogSide } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useState, type FormEvent } from 'react';
import { useSfx } from '@/lib/sfx';
import { parseAddress } from '@/lib/zama/config';
import { encryptU8s } from '@/lib/zama/fhe';
import { errorMessage } from '@/features/zama/credits/CSkirmBalance';
import { boardCells, togglePick } from './board';
import { FOG_DEFAULT_WINDOW_S, isOpenSeat, parseGameId, type FogGame } from './fog';
import { FogBoard } from './FogBoard';
import type { FogDeps } from './FogPlay';
import s from './fog.module.css';

const WINDOWS = [
  { s: 2 * 60, label: '2 min' },
  { s: 5 * 60, label: '5 min' },
  { s: FOG_DEFAULT_WINDOW_S, label: '10 min' },
  { s: 60 * 60, label: '1 hour' },
];

export interface FogLobbyProps extends FogDeps {
  /** Open a game (after creating or joining it, or to watch one). */
  onEnter(id: bigint): void;
}

function TrapPicker({ side, picks, onPicks, busy }: { side: FogSide; picks: number[]; onPicks(p: number[]): void; busy: boolean }) {
  const sfx = useSfx();
  const band = fogTrapBand(side);
  return (
    <div className={s.setup}>
      <FogBoard
        cells={boardCells({ side, setupPicks: picks })}
        mode="setup"
        busy={busy}
        label="Plant two flood switches"
        onPick={(c) => {
          sfx.play('tick');
          onPicks(togglePick(picks, c.tile));
        }}
      />
      <p className={s.note}>
        Plant {2 - picks.length > 0 ? `${2 - picks.length} more` : 'both'} flood switches on the lit tiles (tiles {band.lo}–{band.hi}: the vial row
        and the row in front of your rival&apos;s home). Only you will ever see them, until the game ends.
      </p>
    </div>
  );
}

export function FogLobby({ address, contract, api, instance, onEnter }: FogLobbyProps) {
  const sfx = useSfx();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [picks, setPicks] = useState<number[]>([]);
  const [windowS, setWindowS] = useState(FOG_DEFAULT_WINDOW_S);
  const [opponent, setOpponent] = useState('');
  const [joinText, setJoinText] = useState('');
  const [found, setFound] = useState<FogGame | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
      sfx.play('bad');
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run('create', async () => {
      const invite = opponent.trim();
      if (invite && !parseAddress(invite)) throw new Error('The invite must be a 0x address, or empty for an open seat.');
      const enc = await encryptU8s(await instance(), contract, address, picks);
      const id = await api.create(invite, windowS, enc);
      sfx.play('good');
      onEnter(id);
    });

  const find = (e: FormEvent) => {
    e.preventDefault();
    void run('find', async () => {
      const id = parseGameId(joinText);
      if (id === null) throw new Error('Enter a game id, e.g. 7.');
      const g = await api.read(id);
      if (g.status === 'none') throw new Error(`There is no game #${id}.`);
      if (g.status !== 'waiting' || g.players[0] === address.toLowerCase()) {
        onEnter(id); // already running, ended, or yours: open it
        return;
      }
      if (!isOpenSeat(g.players[1]) && g.players[1] !== address.toLowerCase()) throw new Error(`Game #${id} is reserved for another address.`);
      setFound(g);
      setPicks([]);
    });
  };

  const join = () =>
    run('join', async () => {
      if (!found) return;
      const enc = await encryptU8s(await instance(), contract, address, picks);
      await api.join(found.id, enc);
      sfx.play('good');
      onEnter(found.id);
    });

  return (
    <section className={`sk-panel ${s.panel} ${s.lobby}`} data-testid="fog-lobby">
      <div className={s.tabs} role="tablist" aria-label="Create or join">
        <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? s.tabOn : s.tab} onClick={() => (setTab('create'), setPicks([]))}>
          Create a game
        </button>
        <button type="button" role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? s.tabOn : s.tab} onClick={() => (setTab('join'), setPicks([]))}>
          Join by id
        </button>
      </div>

      {tab === 'create' ? (
        <div className={s.form}>
          <TrapPicker side={0} picks={picks} onPicks={setPicks} busy={!!busy} />
          <label className={s.field}>
            <span>Move clock</span>
            <select value={windowS} onChange={(e) => setWindowS(Number(e.target.value))} className={s.input}>
              {WINDOWS.map((w) => (
                <option key={w.s} value={w.s}>
                  {w.label} per move
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>Invite (optional)</span>
            <input className={s.input} value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="0x… or leave open" spellCheck={false} />
          </label>
          <Button variant="primary" disabled={picks.length !== 2} loading={busy === 'create'} onClick={() => void create()} data-testid="fog-create">
            Seal traps and create
          </Button>
        </div>
      ) : (
        <div className={s.form}>
          <form onSubmit={find} className={s.row}>
            <input
              className={s.input}
              value={joinText}
              onChange={(e) => setJoinText(e.target.value)}
              placeholder="Game id, e.g. 7"
              aria-label="Game id"
              inputMode="numeric"
              data-testid="fog-join-id"
            />
            <Button type="submit" size="sm" loading={busy === 'find'}>
              Find
            </Button>
          </form>
          {found ? (
            <>
              <p className={s.lead}>Game #{String(found.id)} is open. Plant your flood switches: joining draws the hidden vial and starts round 1.</p>
              <TrapPicker side={1} picks={picks} onPicks={setPicks} busy={!!busy} />
              <Button variant="primary" disabled={picks.length !== 2} loading={busy === 'join'} onClick={() => void join()} data-testid="fog-join">
                Seal traps and join
              </Button>
            </>
          ) : null}
        </div>
      )}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
