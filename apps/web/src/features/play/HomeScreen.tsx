'use client';
// S02 Home (/play): the v2 Command deck (CommandDeck.tsx) over the arena, as in the prototype's
// lobby, and under it the daily and weekly quests with the play streak (QuestsPanel.tsx). The deck's
// Practice tile opens a quick match against the bot crew; casual maps and difficulties are picked in
// the atlas.
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
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
      <h1 className="sk-sr-only">Command</h1>
      {me.isError && !me.data ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : null}
      <CommandDeck lead={me.data?.agents[0]} agents={me.data?.agents} elo={me.data?.rank.elo} />
      <QuestsPanel />
    </>
  );
}
