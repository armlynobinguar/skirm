'use client';
// S02 Home (/play): only the v2 Command deck (CommandDeck.tsx) over the arena, as in the prototype's
// lobby. Everything else sits behind one lightbulb in the deck's corner (HomeHub.tsx): the first
// steps, the daily and weekly quests with the play streak, the campaign and puzzles. Below the fold,
// the showreel (Showreel.tsx) plays real bot-vs-bot matches like a trailer.
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { useMe } from '@/lib/api/queries';
import styles from './play.module.css';
import { CommandDeck } from './CommandDeck';
import { HomeHub } from './HomeHub';
import { Showreel } from './Showreel';

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
  const lead = me.data?.agents[0];
  return (
    <>
      <h1 className="sk-sr-only">Play</h1>
      {me.isError && !me.data ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : null}
      <CommandDeck lead={lead} agents={me.data?.agents} elo={me.data?.rank.elo} hub={<HomeHub lead={lead} />} />
      <Showreel />
    </>
  );
}
