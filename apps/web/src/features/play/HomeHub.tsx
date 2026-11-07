'use client';
// The home hub: one lightbulb button over the Command deck that holds everything that is not the
// deck itself, so home shows only the deck. It opens a panel with the first steps (while a new
// player has them), the daily and weekly quests with the play streak, and the campaign and puzzles.
// The badge counts what wants a click: quests ready to claim and first steps left. Escape or a click
// outside closes it; following a link inside closes it too.
import { useEffect, useRef, useState } from 'react';
import { CampaignStrip } from '@/features/campaign/CampaignStrip';
import { FirstSteps, useFirstStepsLeft } from '@/features/onboarding/FirstSteps';
import { PuzzlesStrip } from '@/features/puzzles/PuzzlesStrip';
import type { Agent } from '@/lib/api/types';
import { QuestsPanel, useClaimableQuests } from './QuestsPanel';
import h from './hub.module.css';

function Bulb() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={h.bulbIcon}>
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomeHub({ lead }: { lead: Agent | undefined }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const claimable = useClaimableQuests();
  const stepsLeft = useFirstStepsLeft();
  const badge = claimable + stepsLeft;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const label = badge > 0 ? `Quests, first steps and modes, ${badge} to do` : 'Quests, first steps and modes';
  return (
    <div className={h.wrap} ref={root}>
      <button
        type="button"
        className={h.bulb}
        aria-expanded={open}
        aria-controls="home-hub"
        aria-label={label}
        title="Quests, first steps and modes"
        onClick={() => setOpen((v) => !v)}
        data-testid="hub-open"
        data-hot={claimable > 0 || undefined}
      >
        <Bulb />
        {badge > 0 ? (
          <b className={h.badge} data-testid="hub-badge" aria-hidden="true">
            {badge}
          </b>
        ) : null}
      </button>
      <div id="home-hub" className={h.panel} hidden={!open} role="dialog" aria-label="Quests, first steps and modes" data-testid="hub">
        <FirstSteps lead={lead} onNavigate={close} />
        <QuestsPanel bare />
        <section className={h.modes} aria-label="More modes">
          <CampaignStrip />
          <PuzzlesStrip />
        </section>
      </div>
    </div>
  );
}
