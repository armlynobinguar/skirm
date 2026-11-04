'use client';
// S14 Leaderboards, the ranked boards beyond the season and the all-time ladder:
// By map (GET /leaderboards/maps/:mapId: ranked wins on one map, with each player's tier) and
// Skills (GET /leaderboards/skills: win rate of skills with DEFAULTS.ranked.skillMinMatches or more
// ranked matches, all versions together).
import { DEFAULTS } from '@skirm/shared';
import { fmt } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { TierBadge, tierFrom } from '@/components/TierBadge';
import { EmptyState } from '@/components/states/EmptyState';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { MAPS, ROTATION_INDEX } from '@/features/arena/world';
import { qk, useMe } from '@/lib/api/queries';
import type { MapLadderRow, SkillLadderRow } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from './pvp.module.css';

/** Rows of each board. */
const BOARD_LIMIT = 100;

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/** Ranked results on one map, picked from the atlas maps (today's rotation first). */
export function ByMap() {
  const api = useApi();
  const me = useMe();
  const [mapId, setMapId] = useState(MAPS[ROTATION_INDEX]?.id ?? MAPS[0]?.id ?? 'copper-hollow');
  const board = useQuery({ queryKey: qk.leaderboards.map(mapId, BOARD_LIMIT), queryFn: () => api.mapLadder(mapId, BOARD_LIMIT) });
  const myId = me.data?.account.id;
  return (
    <section aria-labelledby="s14-maps" className={s.card} data-testid="s14-maps">
      <div className={s.cardHead}>
        <h2 id="s14-maps" className={s.h2}>
          By map
        </h2>
        <label className={s.meta}>
          Map{' '}
          <select value={mapId} onChange={(e) => setMapId(e.target.value)} data-testid="s14-map-pick">
            {MAPS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryView
        query={board}
        loading={<Skeleton rows={6} label="Loading the map board" />}
        empty={(d) =>
          d.rows.length === 0 && (
            <EmptyState action={<Link href={routes.pvp()} className="app-link-strong">Queue for ranked</Link>}>
              No ranked matches on this map yet.
            </EmptyState>
          )
        }
      >
        {(d) => (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Map leaderboard">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Tier</th>
                  <th scope="col" className={s.num}>
                    Wins
                  </th>
                  <th scope="col" className={s.num}>
                    W–L–D
                  </th>
                  <th scope="col" className={s.num}>
                    Win rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <MapLine key={r.account.id} r={r} you={r.account.id === myId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      <p className={s.note}>Ranked matches on this map only: most wins first, then win rate.</p>
    </section>
  );
}

function MapLine({ r, you }: { r: MapLadderRow; you: boolean }) {
  return (
    <tr className={you ? s.youRow : undefined} data-testid={`s14-map-row-${r.rank}`} data-you={you || undefined}>
      <td className={s.rank}>{r.rank}</td>
      <td>
        {r.account.handle}
        {you ? ' · you' : ''}
      </td>
      <td>
        <TierBadge tier={tierFrom(r)} size="sm" />
      </td>
      <td className={s.num}>{fmt(r.wins)}</td>
      <td className={s.num}>
        {r.wins}–{r.losses}–{r.draws}
      </td>
      <td className={s.num}>{pct(r.winRate)}</td>
    </tr>
  );
}

/** Skills by ranked win rate, only those with the minimum number of ranked matches. */
export function SkillsBoard() {
  const api = useApi();
  const board = useQuery({ queryKey: qk.leaderboards.skills(undefined, BOARD_LIMIT), queryFn: () => api.skillLadder({ limit: BOARD_LIMIT }) });
  const min = board.data?.minMatches ?? DEFAULTS.ranked.skillMinMatches;
  return (
    <section aria-labelledby="s14-skills" className={s.card} data-testid="s14-skills">
      <div className={s.cardHead}>
        <h2 id="s14-skills" className={s.h2}>
          Skills
        </h2>
        <span className={s.meta}>Win rate in ranked matches, at least {fmt(min)} played</span>
      </div>
      <QueryView
        query={board}
        loading={<Skeleton rows={6} label="Loading the skills board" />}
        empty={(d) =>
          d.rows.length === 0 && (
            <EmptyState action={<Link href={routes.market()} className="app-link-strong">Browse the Exchange</Link>}>
              No skill has {fmt(d.minMatches)} ranked matches yet.
            </EmptyState>
          )
        }
      >
        {(d) => (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Skill leaderboard">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Skill</th>
                  <th scope="col">Creator</th>
                  <th scope="col" className={s.num}>
                    Win rate
                  </th>
                  <th scope="col" className={s.num}>
                    W–L–D
                  </th>
                  <th scope="col" className={s.num}>
                    Matches
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <SkillLine key={r.skill.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      <p className={s.note}>Every version of a skill counts; a crew carrying it on two agents counts once per match.</p>
    </section>
  );
}

function SkillLine({ r }: { r: SkillLadderRow }) {
  return (
    <tr data-testid={`s14-skill-row-${r.rank}`}>
      <td className={s.rank}>{r.rank}</td>
      <td>
        <Link href={routes.marketSkill(r.skill.id)} className="app-link-strong">
          {r.skill.name}
        </Link>
      </td>
      <td>{r.creator.handle}</td>
      <td className={s.num}>{pct(r.winRate)}</td>
      <td className={s.num}>
        {r.wins}–{r.losses}–{r.draws}
      </td>
      <td className={s.num}>{fmt(r.matches)}</td>
    </tr>
  );
}
