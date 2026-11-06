'use client';
// S02 Home (/play): the v2 Command deck (CommandDeck.tsx) over the arena, as in the prototype's
// lobby, and under it the daily and weekly quests with the play streak (QuestsPanel.tsx). The deck's
// Practice tile opens a quick match against the bot crew; casual maps and difficulties are picked in
// the atlas. A new player's "first steps" checklist waits behind a lightbulb button until done or
// hidden (features/onboarding); the campaign and puzzles sit side by side as two short tiles
// (features/campaign, features/puzzles).
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { CampaignStrip } from '@/features/campaign/CampaignStrip';
import { FirstSteps } from '@/features/onboarding/FirstSteps';
import { PuzzlesStrip } from '@/features/puzzles/PuzzlesStrip';
import { useMe } from '@/lib/api/queries';
import styles from './play.module.css';
import { CommandDeck } from './CommandDeck';
import { QuestsPanel } from './QuestsPanel';

export function HomeScreen() {
  return (
    <div data-testid="screen-s02" className={styles.page}>
      <RequireSession>
        <Home />
      </RequireSession>
    </div>
  );
}

function Home() {
  const me = useMe();
  return (
    <>
      <h1 className="sk-sr-only">Play</h1>
      {me.isError && !me.data ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : null}
      <FirstSteps lead={me.data?.agents[0]} />
      <div className={styles.modes}>
        <CampaignStrip />
        <PuzzlesStrip />
      </div>
      <CommandDeck lead={me.data?.agents[0]} agents={me.data?.agents} elo={me.data?.rank.elo} />
      <QuestsPanel />
    </>
  );
}
