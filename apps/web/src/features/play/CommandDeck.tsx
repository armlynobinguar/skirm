'use client';
// The Command deck (the prototype's lobby): your lead agent on the left, and the main menu on the
// right. Ranked Skirmish (the hub) is the biggest tile, then the Map Atlas, Crew (the lead agent's
// editor), Skills, the Ladder (the leaderboards) and Practice: Quick practice against the greedy bot
// on DEFAULT_PRACTICE (the crew screen with "Vs Greedy bot" on), and the Daily challenge (today's
// seed, the same for everyone, and its global board). Nothing here is made up: no
// scripted barks and no feed ticker.
// Every tile shares the header's icon language: a textured plate with its code-drawn icon top right,
// a large faint copy as a watermark, a serial code (OP·01 to DLY·07), grain and hatching, hazard
// tape in the corner and a halftone in the tile colour that strengthens on hover. Sits over the arena.
import { BOT_HANDLE, DAILY_TWISTS, DEFAULT_PRACTICE, DIFF_MODS, MAPS_V2, dailyChallenge, dailyDate } from '@skirm/engine/v2';
import { OUTFIT_COLORS, SKIN_TONES, lookColours } from '@skirm/shared';
import { AkIcon, DisplayHeading, type AkIconName } from '@skirm/ui';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { roleTitle } from '@/features/arena/roles';
import { DIFFS, MAPS, ROTATION_INDEX, diffIndex, mapById } from '@/features/arena/world';
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
  /** Drawn in the top-left corner over the lead agent (home's lightbulb hub). */
  hub?: ReactNode;
}

export function CommandDeck({ lead, agents, elo, hub }: CommandDeckProps) {
  const role = lead ? roleTitle(lead.unlocks) : null;
  const skill = lead?.skills[0]?.name;
  const rotation = MAPS[ROTATION_INDEX]!;
  const smallest = MAPS[0]!.A;
  const largest = MAPS[MAPS.length - 1]!.A;
  const crewNames = (agents ?? []).slice(0, 3).map((a) => a.name);
  const practiceMap = mapById(DEFAULT_PRACTICE.mapId)?.name ?? DEFAULT_PRACTICE.mapId;
  const practiceDiff = DIFFS[diffIndex(DEFAULT_PRACTICE.difficulty)]!.n;
  const daily = dailyChallenge(dailyDate());
  const dailyMap = MAPS_V2.find((m) => m.id === daily.mapId)?.name ?? daily.mapId;
  const dailyDiff = DIFF_MODS[daily.difficulty].name;

  return (
    <section className={styles.deck} aria-label="Command deck" data-testid="s02-deck">
      <div className={styles.assist} data-rise style={{ '--rise-i': 0 } as CSSProperties}>
        {hub}
        {lead ? (
          <AgentPortrait
            body={OUTFIT_COLORS[lead.appearance.outfit] ?? OUTFIT_COLORS[0]}
            head={SKIN_TONES[lead.appearance.skin] ?? SKIN_TONES[0]}
            dress={lookColours(lead.appearance).dress}
            team="A"
            label={`Your lead agent, ${lead.name}`}
            role={lead.role}
            variant="hero"
            className={styles.hero}
          />
        ) : (
          <div className={styles.hero} />
        )}
        <div className={styles.plate}>
          <DisplayHeading level={2} className={styles.plateName}>
            {lead?.name ?? '…'}
          </DisplayHeading>
          <div className={styles.plateMeta}>
            <span className="sk-kick">
              <b>{role ?? 'Agent'}</b> · crew lead
            </span>
            <span className="sk-kick">
              {skill ?? 'No skill equipped'} · talk: standard
            </span>
          </div>
        </div>
      </div>

      <nav className={styles.menu} aria-label="Command">
        <Tile
          href={routes.pvp()}
          className={styles.rk}
          code="Ranked · 2 crews · 5:00"
          name="Skirmish"
          sub={`${elo === undefined ? '' : `Elo ${elo} · `}${rotation.code} ${rotation.name} in rotation · ${MAPS.length} maps, ${smallest.w}×${smallest.h} to ${largest.w}×${largest.h} · talk locked to standard`}
          icon="skirm"
          serial="OP·01"
          go="Queue ▸"
          i={0}
          testId="s02-tile-ranked"
        />
        <Tile
          href={routes.atlas()}
          className={styles.atlas}
          code="Map atlas"
          name={`${MAPS.length} maps`}
          sub="Goals, pressure, themed verbs"
          icon="atlas"
          serial="MAP·02"
          i={1}
          testId="s02-tile-atlas"
        />
        <Tile
          href={lead ? routes.agent(lead.id) : routes.account()}
          tone="var(--amber)"
          code="Squad"
          name="Crew"
          sub={crewNames.length ? `${crewNames.join(', ')} · prompts, skills, stats` : 'Edit prompts, skills and stats'}
          icon="crew"
          serial="SQD·03"
          i={2}
          testId="s02-tile-crew"
        />
        <Tile
          href={routes.market()}
          tone="var(--violet)"
          code="Exchange"
          name="Skills"
          sub="Proof on every listing"
          icon="proof"
          serial="EXC·04"
          i={3}
          testId="s02-tile-skills"
        />
        <Tile
          href={routes.leaderboards()}
          tone="var(--bone)"
          code="Player ladder"
          name="Ladder"
          sub="Rank titles and every player's Elo"
          icon="lb"
          serial="LDR·05"
          i={4}
          testId="s02-tile-ladder"
        />
        <Tile
          href={routes.practice(DEFAULT_PRACTICE)}
          tone="var(--water)"
          code={`Vs ${BOT_HANDLE}`}
          name="Practice"
          sub={`Quick practice · ${practiceMap} · ${practiceDiff} · starts at once`}
          icon="practice"
          serial="PRC·06"
          i={5}
          testId="s02-tile-practice"
        />
        <Tile
          href={routes.daily()}
          className={styles.daily}
          tone="var(--amber)"
          code="One seed a day · global board"
          name="Daily"
          sub={`Today: ${dailyMap} · ${dailyDiff} · ${DAILY_TWISTS[daily.twist].name}`}
          icon="lb"
          serial="DLY·07"
          i={6}
          testId="s02-tile-daily"
        />
      </nav>
    </section>
  );
}

function Tile({
  href,
  className,
  tone,
  code,
  name,
  sub,
  icon,
  serial,
  go,
  i,
  testId,
}: {
  href: string;
  className?: string;
  tone?: string;
  code: string;
  name: string;
  sub: string;
  icon: AkIconName;
  /** Serial code under the icon plate (OP·01 to DLY·07). */
  serial: string;
  go?: string;
  i: number;
  testId: string;
}) {
  const sfx = useSfx();
  return (
    <Link
      href={href}
      className={`${styles.tile} ${className ?? ''}`}
      style={{ ...(tone ? { '--tc': tone } : {}), '--rise-i': i + 1 } as CSSProperties}
      data-rise
      data-testid={testId}
      onClick={() => sfx.play('click')}
      onMouseEnter={() => sfx.play('hover')}
    >
      <span className={styles.tx} aria-hidden="true" />
      <AkIcon name={icon} className={styles.twm} />
      <span className={`sk-ni ${styles.tgl}`} aria-hidden="true">
        <AkIcon name={icon} />
      </span>
      <i className={styles.tser} aria-hidden="true">
        {serial}
      </i>
      <span className={styles.code}>{code}</span>
      <span className={styles.name}>{name}</span>
      <span className={styles.sub}>{sub}</span>
      {go ? <span className={styles.go}>{go}</span> : null}
    </Link>
  );
}
