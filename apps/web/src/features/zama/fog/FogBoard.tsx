'use client';
// The 5x5 Fog Skirm grid: your home row at the bottom, the vial row in the middle, fog over every
// tile you cannot see. Shows your scout (user-decrypted), your traps, the ghost of your sealed move
// and, after the game, the revealed board. Presentational: the parent decides what is clickable.
import type { FogCell } from './board';
import s from './fog.module.css';

export interface FogBoardProps {
  cells: readonly FogCell[];
  /** Click handler for move targets (play) or plantable tiles (setup). */
  onPick?: (cell: FogCell) => void;
  mode: 'setup' | 'play' | 'reveal';
  /** Disables every click (a transaction is in flight). */
  busy?: boolean;
  /** Your scout carries the vial. */
  carrying?: boolean;
  /** Bumped on each new round so the ping animation replays. */
  pulseKey?: number;
  label: string;
}

function cellLabel(c: FogCell, mode: FogBoardProps['mode']): string {
  const parts = [`Row ${c.row + 1}, column ${c.col + 1}`];
  if (c.mine) parts.push('your scout');
  if (c.myTrap) parts.push(c.myTrap === 'live' ? 'your flood switch' : 'your spent flood switch');
  if (c.picked) parts.push('trap picked');
  if (c.revealedVial) parts.push('the vial was here');
  if (c.revealedRivalTrap) parts.push("rival's flood switch");
  if (c.revealedRival) parts.push("rival's scout");
  if (mode === 'play' && c.move !== null) parts.push('move here');
  if (mode === 'setup' && c.plantable) parts.push('can hold a trap');
  return parts.join(', ');
}

export function FogBoard({ cells, onPick, mode, busy, carrying, pulseKey, label }: FogBoardProps) {
  return (
    <div className={s.board} role="grid" aria-label={label} data-testid="fog-board" data-mode={mode}>
      {cells.map((c) => {
        const clickable = !busy && !!onPick && ((mode === 'play' && c.move !== null) || (mode === 'setup' && c.plantable));
        const fogged = mode === 'play' && !c.mine && !c.homeMine && c.myTrap === null && !c.ghost;
        const cls = [
          s.cell,
          c.homeMine ? s.homeMine : '',
          c.homeRival ? s.homeRival : '',
          c.vialRow ? s.vialRow : '',
          fogged ? s.fog : '',
          clickable ? s.target : '',
          mode === 'setup' && !c.plantable ? s.dim : '',
          c.picked ? s.picked : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={c.tile}
            type="button"
            role="gridcell"
            className={cls}
            disabled={!clickable}
            onClick={clickable ? () => onPick?.(c) : undefined}
            aria-label={cellLabel(c, mode)}
            data-testid={`fog-tile-${c.tile}`}
            data-move={c.move ?? undefined}
          >
            {c.myTrap ? <span className={`${s.trap} ${c.myTrap === 'spent' ? s.spent : ''}`} aria-hidden="true">≈</span> : null}
            {c.picked ? <span className={s.trap} aria-hidden="true">≈</span> : null}
            {c.revealedRivalTrap ? <span className={`${s.trap} ${s.rivalTrap}`} aria-hidden="true">≈</span> : null}
            {c.revealedVial ? <span className={s.vial} aria-hidden="true">⚗</span> : null}
            {c.revealedRival ? <span className={`${s.scout} ${s.rival}`} aria-hidden="true" /> : null}
            {c.ghost ? <span className={`${s.scout} ${s.ghost}`} aria-hidden="true" /> : null}
            {c.mine ? (
              <span key={pulseKey} className={`${s.scout} ${s.mine} ${carrying ? s.carrying : ''}`} aria-hidden="true" data-testid="fog-my-scout">
                {carrying ? '⚗' : ''}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
