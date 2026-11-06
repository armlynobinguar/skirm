'use client';
// S14 Leaderboards (/leaderboards). Design: S14-Leaderboards.dc.html; spec: uiux.md S14.
// Tabs: Season (GET /seasons/current for the season, its pool and your row; GET /seasons/:id/standings
// for the rows: points from ranked v2 matches, W–L–D, Elo and the place's projected prize) and
// All-time (GET /leaderboards/players: per-player Elo and ranked tier on the v2 ladder), By map
// (GET /leaderboards/maps/:mapId: ranked wins on one map) and Skills (GET /leaderboards/skills: win
// rate of skills with enough ranked matches).
// While the season is not recorded on the seasons contract (poolSource 'local') the pool is skirm's
// own tally (funding + the fee share of market sales), and the card says so in plain words. An empty
// pool says how it fills instead of showing 0.00 NEAR.
// The tab is kept in the URL (?tab=alltime|maps|skills) for sharing; the season is the default.
import { DEFAULTS } from '@skirm/shared';
import { Tabs, fmt } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TierBadge, tierFrom } from '@/components/TierBadge';
import { EmptyState } from '@/components/states/EmptyState';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { qk, useCurrentSeason, useMe, useSeasonStandings } from '@/lib/api/queries';
import type { PlayerLadderRow, Season, Standing } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from './pvp.module.css';
import { fmtCountdown, nearText, sumYocto, useNow } from './pvpUtil';
import { ByMap, SkillsBoard } from './RankedBoards';

type Tab = 'season' | 'alltime' | 'maps' | 'skills';

const TABS = [
  { id: 'season', label: 'Season', icon: 'trophy' as const },
  { id: 'alltime', label: 'All-time', icon: 'elo' as const },
  { id: 'maps', label: 'By map', icon: 'map' as const },
  { id: 'skills', label: 'Skills', icon: 'skill' as const },
];
const TAB_LABEL: Record<Tab, string> = { season: 'Season', alltime: 'All-time', maps: 'By map', skills: 'Skills' };

/** Rows of a season's standings shown on the screen. */
const STANDINGS_LIMIT = 100;
/** Rows of the all-time ladder. */
const LADDER_LIMIT = 100;

function readTab(): Tab {
  if (typeof window === 'undefined') return 'season';
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'alltime' || t === 'maps' || t === 'skills' ? t : 'season';
}

function writeTab(tab: Tab) {
  try {
    const qs = tab === 'season' ? '' : `?tab=${tab}`;
    window.history.replaceState(window.history.state, '', window.location.pathname + qs);
  } catch {
    /* ignore */
  }
}

export function LeaderboardsScreen() {
  const [tab, setTab] = useState<Tab>('season');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTab(readTab());
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) writeTab(tab);
  }, [ready, tab]);

  return (
    <div className={s.page} data-testid="screen-s14">
      <h1 className="app-h1">Leaderboards</h1>
      <div className={s.tabsRow}>
        <div className={s.tabsGrow} data-testid="s14-tabs">
          <Tabs tabs={TABS} value={tab} onChange={(id) => setTab(id as Tab)} label="Leaderboard" />
        </div>
      </div>
      <div role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {tab === 'season' ? <SeasonBoard /> : tab === 'alltime' ? <AllTime /> : tab === 'maps' ? <ByMap /> : <SkillsBoard />}
      </div>
    </div>
  );
}

function SeasonBoard() {
  const current = useCurrentSeason();
  return (
    <section aria-labelledby="s14-season" className={s.card} data-testid="s14-season">
      <QueryView query={current} loading={<Skeleton rows={6} label="Loading the season" />}>
        {(d) => <SeasonBody season={d.season} you={d.you} />}
      </QueryView>
    </section>
  );
}

function SeasonBody({ season, you }: { season: Season; you: Standing | undefined }) {
  const standings = useSeasonStandings(season.id, { limit: STANDINGS_LIMIT });
  const now = useNow(1000, season.status === 'open');
  const left = Date.parse(season.endsAt) - now;
  return (
    <>
      <div className={s.cardHead}>
        <h2 id="s14-season" className={s.h2}>
          Season {season.number}
        </h2>
        <span className={s.meta} data-testid="s14-season-countdown">
          {season.status !== 'open' ? (season.status === 'paid' ? 'Ended · prizes paid' : 'Ended · prizes being settled') : left > 0 ? `Ends in ${fmtCountdown(left)}` : 'Ending now'}
        </span>
      </div>
      <p className={s.lede} data-testid="s14-season-pool">
        <PoolText season={season} /> Ranked wins earn {DEFAULTS.season.points.win} points, draws {DEFAULTS.season.points.draw}, losses{' '}
        {DEFAULTS.season.points.loss}.
      </p>
      <QueryView
        query={standings}
        loading={<Skeleton rows={6} label="Loading the standings" />}
        empty={(d) =>
          d.rows.length === 0 && (
            <EmptyState
              action={
                <span className={s.actions}>
                  <Link href={routes.pvp()} className="sk-btn sk-btn-primary" data-testid="s14-empty-play">
                    Play ranked
                  </Link>
                  <Link href={routes.verify()} className="app-link-strong" data-testid="s14-empty-verify">
                    See how results are verified on NEAR
                  </Link>
                </span>
              }
            >
              <b>The board is open.</b> No one has played a ranked match this season yet, so your first win takes first place. Every
              ranked result is written to NEAR, where anyone can check it.
            </EmptyState>
          )
        }
      >
        {(d) => <StandingsTable rows={d.rows} total={d.total} you={you} />}
      </QueryView>
    </>
  );
}

/** The pool line: its size and where it is kept, or, while it is empty, how it fills. */
function PoolText({ season }: { season: Season }) {
  const places = season.splitBps.length;
  const feePct = DEFAULTS.season.feeShareBps / 100;
  if (sumYocto(season.poolYocto) === 0n) {
    return season.status === 'open' ? (
      <>
        No prize pool yet: {feePct}% of every skill-market fee taken this season goes into it, split among the top {places}.
      </>
    ) : (
      <>This season ended with no prize pool.</>
    );
  }
  return (
    <>
      Prize pool <b className={s.mono}>{nearText(season.poolYocto)}</b>
      {season.poolSource === 'local' ? (
        <>
          {' '}
          <span
            className={s.chip}
            title="skirm's server keeps this tally until the season is recorded on the seasons contract on NEAR"
            data-testid="s14-pool-local"
          >
            tallied offchain, not yet on NEAR
          </span>
        </>
      ) : null}{' '}
      · paid to the top {places}.
    </>
  );
}

function StandingsTable({ rows, total, you }: { rows: Standing[]; total: number; you: Standing | undefined }) {
  const youIn = !!you && rows.some((r) => r.account.id === you.account.id);
  return (
    <>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="Season standings">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col" className={s.num}>
                Points
              </th>
              <th scope="col" className={s.num}>
                W–L–D
              </th>
              <th scope="col" className={s.num}>
                Elo
              </th>
              <th scope="col" className={s.num}>
                Projected prize
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <StandingRow key={r.account.id} r={r} you={!!you && r.account.id === you.account.id} />
            ))}
            {you && !youIn ? <StandingRow r={you} you /> : null}
          </tbody>
        </table>
      </div>
      {total > rows.length ? (
        <p className={s.note}>
          Top {fmt(rows.length)} of {fmt(total)} players.
        </p>
      ) : null}
    </>
  );
}

function StandingRow({ r, you }: { r: Standing; you: boolean }) {
  return (
    <tr className={you ? s.youRow : undefined} data-testid={`s14-season-row-${r.rank}`} data-you={you || undefined}>
      <td className={s.rank}>{r.rank}</td>
      <td>
        {r.account.handle}
        {you ? ' · you' : ''}
      </td>
      <td className={s.num}>{fmt(r.points)}</td>
      <td className={s.num}>
        {r.wins}–{r.losses}–{r.draws}
      </td>
      <td className={s.num}>{fmt(r.elo)}</td>
      <td className={s.num}>{r.projectedPrizeYocto === null ? '—' : nearText(r.projectedPrizeYocto)}</td>
    </tr>
  );
}

function AllTime() {
  const api = useApi();
  const me = useMe();
  const ladder = useQuery({ queryKey: qk.leaderboards.players(LADDER_LIMIT), queryFn: () => api.playerLadder(LADDER_LIMIT) });
  const myId = me.data?.account.id;
  return (
    <section aria-labelledby="s14-alltime" className={s.card} data-testid="s14-alltime">
      <div className={s.cardHead}>
        <h2 id="s14-alltime" className={s.h2}>
          All-time
        </h2>
        <span className={s.meta}>Elo per player, ranked v2 matches</span>
      </div>
      <QueryView
        query={ladder}
        loading={<Skeleton rows={6} label="Loading the ladder" />}
        empty={(d) =>
          d.rows.length === 0 && (
            <EmptyState action={<Link href={routes.pvp()} className="app-link-strong">Queue for ranked</Link>}>
              No ranked matches yet. Win one to take the first place.
            </EmptyState>
          )
        }
      >
        {(d) => {
          const youRow = d.you ?? d.rows.find((r) => r.account.id === myId);
          const youIn = !!youRow && d.rows.some((r) => r.account.id === youRow.account.id);
          return (
            <div className={s.tableWrap}>
              <table className={s.table} aria-label="All-time ladder">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Player</th>
                    <th scope="col">Tier</th>
                    <th scope="col">Title</th>
                    <th scope="col" className={s.num}>
                      Elo
                    </th>
                    <th scope="col" className={s.num}>
                      W–L–D
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <LadderLine key={r.account.id} r={r} you={!!youRow && r.account.id === youRow.account.id} />
                  ))}
                  {youRow && !youIn ? <LadderLine r={youRow} you /> : null}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryView>
      <p className={s.note}>
        Every player starts at 1,200. Only ranked matches move Elo. The tier shows after {DEFAULTS.ranked.placementMatches}{' '}
        placement matches.
      </p>
    </section>
  );
}

function LadderLine({ r, you }: { r: PlayerLadderRow; you: boolean }) {
  return (
    <tr className={you ? s.youRow : undefined} data-testid={`s14-alltime-row-${r.rank}`} data-you={you || undefined}>
      <td className={s.rank}>{r.rank}</td>
      <td>
        {r.account.handle}
        {you ? ' · you' : ''}
      </td>
      <td>
        <TierBadge tier={tierFrom(r)} size="sm" />
      </td>
      <td>{r.title}</td>
      <td className={s.num}>{fmt(r.elo)}</td>
      <td className={s.num}>
        {r.wins}–{r.losses}–{r.draws}
      </td>
    </tr>
  );
}
