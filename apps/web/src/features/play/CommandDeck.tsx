'use client';
// The Command deck, in the Tactical HUD look (B). Left: the squad, one unit card per agent (portrait,
// role, sight and voice pips, skill and talk tier), and the map in today's ranked rotation. Right:
// DEPLOY (the Skirmish hub, ranked), Practice vs the greedy bot and the Daily challenge, the season
// panel, and quick links to the Exchange and the Ladder. Nothing here is made up: no scripted barks
// and no feed ticker.
import { BOT_HANDLE, DAILY_TWISTS, DEFAULT_PRACTICE, DIFF_MODS, MAPS_V2, dailyChallenge, dailyDate } from '@skirm/engine/v2';
import { OUTFIT_COLORS, SKIN_TONES, lookColours } from '@skirm/shared';
import { DisplayHeading } from '@skirm/ui';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { roleTitle } from '@/features/arena/roles';
import { DIFFS, MAPS, ROTATION_INDEX, diffIndex, mapById } from '@/features/arena/world';
import { useCurrentSeason } from '@/lib/api/queries';
import type { Agent } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useSfx } from '@/lib/sfx';
import styles from './deck.module.css';

export interface CommandDeckProps {
  /** Lead agent: the first of yours. Undefined while loading. */
  lead: Agent | undefined;
  agents: Agent[] | undefined;
  /** Your ranked Elo (me.rank); undefined while loading. */
  elo?: number;
  /** Your rank title (me.rank.title), e.g. "Breach Runner II". */
  rankTitle?: string;
  /** Drawn next to the squad heading (home's lightbulb hub). */
  hub?: ReactNode;
}

/** "3 d 4 h", "5 h", "12 m" until `at`; null once it has passed. */
function left(at: string): string | null {
  const ms = Date.parse(at) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h` : `${min} m`;
}

function Pips({ value, label }: { value: number; label: string }) {
  return (
    <span className={styles.stat}>
      <span className={styles.statName}>{label}</span>
      <span className={styles.bar} role="img" aria-label={`${label} ${value} of 5`}>
        <span style={{ width: `${Math.max(0, Math.min(5, value)) * 20}%` }} />
      </span>
    </span>
  );
}

export function CommandDeck({ lead, agents, elo, rankTitle, hub }: CommandDeckProps) {
  const sfx = useSfx();
  const click = () => sfx.play('click');
  const hover = () => sfx.play('hover');
  const rotation = MAPS[ROTATION_INDEX]!;
  const crew = (agents ?? []).slice(0, 3);
  const crewNames = crew.map((a) => a.name);
  const practiceMap = mapById(DEFAULT_PRACTICE.mapId)?.name ?? DEFAULT_PRACTICE.mapId;
  const practiceDiff = DIFFS[diffIndex(DEFAULT_PRACTICE.difficulty)]!.n;
  const daily = dailyChallenge(dailyDate());
  const dailyMap = MAPS_V2.find((m) => m.id === daily.mapId)?.name ?? daily.mapId;
  const dailyDiff = DIFF_MODS[daily.difficulty].name;
  const season = useCurrentSeason().data?.season;
  const seasonLeft = season ? left(season.endsAt) : null;
  const seasonDays = season ? Math.max(1, Math.round((Date.parse(season.endsAt) - Date.parse(season.startsAt)) / 86_400_000)) : 14;
  const seasonDone = season ? Math.min(1, Math.max(0, (Date.now() - Date.parse(season.startsAt)) / (Date.parse(season.endsAt) - Date.parse(season.startsAt)))) : 0;

  return (
    <section className={styles.deck} aria-label="Command deck" data-testid="s02-deck">
      <div className={styles.squad}>
        <header className={styles.head} data-rise style={{ '--rise-i': 0 } as CSSProperties}>
          {hub ? <div className={styles.hub}>{hub}</div> : null}
          <div className={styles.headText}>
            <span className="sk-kick">
              <b>Squad</b> · {crew.length || '…'} / 3 ready
            </span>
            <DisplayHeading level={2} className={styles.title}>
              Your crew
            </DisplayHeading>
          </div>
          <div className={styles.headSide}>
            <Link
              href={lead ? routes.agent(lead.id) : routes.account()}
              className={styles.manage}
              data-testid="s02-tile-crew"
              onClick={click}
            >
              <span className={styles.manageName}>Manage crew ▸</span>
              <span className={styles.manageSub}>{crewNames.length ? `${crewNames.join(', ')} · prompts, skills, stats` : 'Edit prompts, skills and stats'}</span>
            </Link>
          </div>
        </header>

        <div className={styles.units}>
          {(crew.length ? crew : [undefined, undefined, undefined]).map((a, i) => {
            const role = a ? (a.role ?? roleTitle(a.unlocks)) : null;
            const skill = a?.skills[0]?.name;
            return (
              <article key={a?.id ?? i} className={styles.unit} data-rise style={{ '--rise-i': i + 1 } as CSSProperties}>
                <div className={styles.unitTop}>
                  <span>Unit {String(i + 1).padStart(2, '0')}</span>
                  <b>{role ?? '…'}</b>
                </div>
                {a ? (
                  <AgentPortrait
                    body={OUTFIT_COLORS[a.appearance.outfit] ?? OUTFIT_COLORS[0]}
                    head={SKIN_TONES[a.appearance.skin] ?? SKIN_TONES[0]}
                    dress={lookColours(a.appearance).dress}
                    team="A"
                    label={i === 0 ? `Your lead agent, ${a.name}` : a.name}
                    role={a.role}
                    className={styles.portrait}
                  />
                ) : (
                  <div className={styles.portrait} />
                )}
                <Link href={a ? routes.agent(a.id) : routes.account()} className={styles.unitName} onClick={click}>
                  {a?.name ?? '…'}
                </Link>
                {i === 0 ? <span className={`sk-kick ${styles.unitLead}`}>{`${role ?? 'Agent'} · crew lead`}</span> : null}
                <div className={styles.stats}>
                  <Pips label="Sight" value={a?.vision ?? 0} />
                  <Pips label="Voice" value={a?.comms ?? 0} />
                </div>
                <span className={skill ? styles.skill : styles.skillEmpty}>{`${skill ?? 'Skill slot empty'} · talk: ${a?.tier ?? 'standard'}`}</span>
              </article>
            );
          })}
        </div>

        <div className={styles.mapCard} data-rise style={{ '--rise-i': 4 } as CSSProperties}>
          <div className={styles.mapText}>
            <span className="sk-kick">
              Deploy to · <b>{rotation.code}</b>
            </span>
            <span className={styles.mapName}>{rotation.name}</span>
            <span className={styles.mapSub}>Today&apos;s ranked rotation · talk locked to standard</span>
          </div>
          <Link href={routes.atlas()} className={styles.mapLink} data-testid="s02-tile-atlas" onClick={click}>
            All {MAPS.length} maps ▸
          </Link>
        </div>
      </div>

      <nav className={styles.side} aria-label="Command">
        <Link
          href={routes.pvp()}
          className={styles.deploy}
          data-rise
          style={{ '--rise-i': 1 } as CSSProperties}
          data-testid="s02-tile-ranked"
          onClick={click}
          onMouseEnter={hover}
        >
          <span className={styles.deployName}>Deploy</span>
          <span className={styles.deploySub}>
            {`Ranked · ${elo === undefined ? '' : `Elo ${elo} · `}${rotation.code} ${rotation.name} in rotation`}
          </span>
        </Link>

        <div className={styles.pair}>
          <Link
            href={routes.practice(DEFAULT_PRACTICE)}
            className={`${styles.alt} ${styles.altYou}`}
            data-rise
            style={{ '--rise-i': 2 } as CSSProperties}
            data-testid="s02-tile-practice"
            onClick={click}
            onMouseEnter={hover}
          >
            <span className={styles.altName}>Practice</span>
            <span className={styles.altSub}>{`Vs ${BOT_HANDLE}`}</span>
            <span className={styles.altSub}>{`Quick practice · ${practiceMap} · ${practiceDiff} · starts at once`}</span>
          </Link>
          <Link
            href={routes.daily()}
            className={`${styles.alt} ${styles.altAmber}`}
            data-rise
            style={{ '--rise-i': 3 } as CSSProperties}
            data-testid="s02-tile-daily"
            onClick={click}
            onMouseEnter={hover}
          >
            <span className={styles.altName}>Daily</span>
            <span className={styles.altSub}>One seed a day · global board</span>
            <span className={styles.altSub}>{`Today: ${dailyMap} · ${dailyDiff} · ${DAILY_TWISTS[daily.twist].name}`}</span>
          </Link>
        </div>

        <section className={styles.season} aria-labelledby="deck-season" data-rise style={{ '--rise-i': 4 } as CSSProperties}>
          <div className={styles.seasonHead}>
            <h2 id="deck-season" className={styles.seasonName}>
              {season ? `Season ${season.number}` : 'Season'}
            </h2>
            <span className="sk-mono sk-muted">{seasonLeft ? `${seasonLeft} left` : season ? 'ending' : ''}</span>
          </div>
          <div className={styles.seasonBar} role="img" aria-label={`Season progress: ${Math.round(seasonDone * seasonDays)} of ${seasonDays} days`}>
            <span style={{ width: `${seasonDone * 100}%` }} />
          </div>
          <div className={styles.seasonGrid}>
            <div>
              <span className="sk-kick">Rank</span>
              <b>{rankTitle ?? '…'}</b>
            </div>
            <div>
              <span className="sk-kick">Elo</span>
              <b>{elo ?? '…'}</b>
            </div>
          </div>
        </section>

        <div className={styles.links} data-rise style={{ '--rise-i': 5 } as CSSProperties}>
          <Link href={routes.market()} className={styles.link} data-testid="s02-tile-skills" onClick={click}>
            <span className={styles.linkName}>Skills</span>
            <span className={styles.linkSub}>Exchange · proof on every listing</span>
          </Link>
          <Link href={routes.leaderboards()} className={styles.link} data-testid="s02-tile-ladder" onClick={click}>
            <span className={styles.linkName}>Ladder</span>
            <span className={styles.linkSub}>Rank titles and every player&apos;s Elo</span>
          </Link>
        </div>
      </nav>
    </section>
  );
}
