'use client';
// v2 match, ended: the debrief (the prototype's s-result). Left: map line, verdict, score, the goal
// and star checks, Queue again. Right: the match report: Elo change and MVP, the difficulty goal,
// talk, verbs, credits held / used / returned, the registry write and the match log hash. Bluff
// stats and season points are designed but not live, so they show "Soon", never a number. Under
// both, the Comms transcript: every line said that this tab saw delivered. A spectator gets the
// result by crew ("ada wins"), no stars and no report of their own; practice carries its badge and
// queues practice again. Last, a player's decision timeline (Decisions: "why did it do that?").
//   Ended          → on the match screen (a void match, or after the banner when the route did not move).
//   V2ResultScreen → /matches/[id]/result: this tab's v2 store, else GET /v2/matches/:id.
import { DIFF_MODS, TICK_MS, mapV2 } from '@skirm/engine/v2';
import { Button, Soon, fmt } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { composeV2Arena } from '@/features/arena/live';
import { arenaStore } from '@/features/arena/store';
import { MAPS, mapById } from '@/features/arena/world';
import { qk } from '@/lib/api/queries';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { PracticeBadge, other } from './common';
import { Decisions } from './Decisions';
import { debriefOf, mvpOf, type DebriefData } from './hud/debrief';
import { clock, feedTag } from './hud/model';
import v from './v2.module.css';
import { useV2Match, type V2CommsLine, type V2MatchView } from './v2Store';

const REASON: Record<string, string> = {
  goal: 'reached the goal',
  time: 'when the clock ran out',
  eliminated: 'with the other crew all out',
  declined: 'A player declined',
  accept_timeout: 'A player did not accept in time',
  credits: 'A crew could not cover its hold',
  error: 'The server hit an error',
  aborted: 'The match was stopped',
};

const DECIDED: Record<string, string> = {
  score: 'more delivered',
  fewer_agents: 'fewer agents fielded',
  earlier: 'reached its score first',
  draw: 'level on everything',
  goal: 'first to the goal',
};

/** The arena behind the debrief: the last frame this tab saw, else the match's map at rest. */
function useResultArena(view: V2MatchView | undefined, mapId: string | undefined) {
  const frame = view?.frame ?? null;
  useEffect(() => {
    const idx = mapId ? MAPS.findIndex((m) => m.id === mapId) : -1;
    if (idx >= 0) arenaStore().setMap(idx);
    arenaStore().setLive(frame ? composeV2Arena(frame) : null, mapId);
    return () => arenaStore().setLive(null);
  }, [frame, mapId]);
}

export function Ended({ view, onReplay }: { view: V2MatchView; onReplay?: () => void }) {
  useResultArena(view, view.mapId);
  const data = debriefOf(view, undefined)!;
  return <Debrief data={data} onReplay={onReplay} />;
}

export function V2ResultScreen({ matchId }: { matchId: string }) {
  const api = useApi();
  const view = useV2Match(matchId);
  const record = useQuery({
    queryKey: qk.matches.v2(matchId),
    queryFn: () => api.v2Match(matchId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === 'live') return 3000;
      return d.ranked && d.status === 'ended' && d.registry.status === 'pending' ? 5000 : false;
    },
  });
  const data = debriefOf(view?.phase === 'ended' ? view : undefined, record.data);
  useResultArena(view, data?.mapId);
  if (!data) {
    if (record.isError) return <ErrorCard error={record.error} onRetry={() => void record.refetch()} title="Could not load this match" />;
    return <Skeleton rows={8} label="Loading result" />;
  }
  if (data.status === 'live')
    return (
      <div className={v.wait} data-testid="v2-result-live">
        <h1 className="app-h2">This match is still running</h1>
        <p className={v.note}>The debrief shows here when it ends.</p>
        <ButtonLink variant="primary" href={routes.match(matchId)}>
          Watch it live
        </ButtonLink>
      </div>
    );
  return <Debrief data={data} replayHref={`${routes.match(matchId)}#replay`} />;
}

function Debrief({ data, onReplay, replayHref }: { data: DebriefData; onReplay?: () => void; replayHref?: string }) {
  const def = mapV2(data.mapId);
  const look = mapById(data.mapId);
  const r = data.result;
  if (!r)
    return (
      <div className={v.ended} data-testid="v2-ended">
        <span className="sk-kick">{look?.name ?? data.mapId}</span>
        <h1 className="sk-disp" data-testid="v2-verdict">
          Void
        </h1>
        <p className={v.note}>{REASON[data.voidReason ?? 'error'] ?? 'The match did not happen'}. Every credit held for it came back.</p>
        <ButtonLink href={routes.pvp()} variant="primary">
          Back to the hub
        </ButtonLink>
      </div>
    );
  const me = data.team;
  const them = other(me);
  const watch = data.watch;
  const win = r.winner === me;
  const nameOf = (t: typeof me) => data.handles[t] ?? `Crew ${t}`;
  const verdict = r.winner === 'draw' ? 'Draw' : watch ? `${nameOf(r.winner)} wins` : win ? 'Victory' : 'Defeat';
  const D = DIFF_MODS[data.difficulty];
  const d = data.debrief;
  const mvp = d ? mvpOf(d) : null;
  const [goal, ...checks] = d?.goals ?? [];
  const stars = watch ? [] : d ? [...(goal ? [{ ...goal, title: `Goal · ${goal.title}` }] : []), ...checks] : [{ title: 'Won the match', met: win, available: true }];
  const verbs = d ? d.agents.reduce((s, a) => s + a.used, 0) : 0;
  const again = watch || data.ranked ? routes.pvp() : data.practice ? routes.practice({ mapId: data.mapId, difficulty: data.difficulty }) : routes.crew(data.mapId, data.difficulty);
  const registry = config.near.contracts.registry;
  return (
    <div className={v.result} data-testid="v2-ended">
      <div className={v.verdict}>
        <span className="sk-kick">
          <b>{def?.code ?? data.mapId}</b> · {def?.name ?? look?.name ?? data.mapId} · <span style={{ color: D.colour }}>{D.name}</span> ·{' '}
          {data.ranked ? 'ranked' : data.practice ? 'practice' : 'casual'} · {clock((r.ticks * TICK_MS) / 1000)} played
          {watch ? ' · watched' : ''}
        </span>
        {data.practice ? <PracticeBadge free={data.free} /> : null}
        <h1 className={v.verdictWord} data-fail={(!watch && !win) || undefined} data-testid="v2-verdict">
          {verdict}
        </h1>
        <div className={v.scoreLine}>
          <span className={v.sa}>{r.score[me]}</span>
          <span className={v.dash}>–</span>
          <span className={v.sb}>{r.score[them]}</span>
          <small>DELIVERED · FIRST TO {data.goal}</small>
        </div>
        <p className={v.note}>
          {r.score[me]} – {r.score[them]} after {r.ticks} ticks, {REASON[r.reason] ?? r.reason} ({DECIDED[r.decidedBy] ?? r.decidedBy}).
          {watch ? ` ${nameOf('A')} vs ${nameOf('B')}.` : data.rivalHandle ? ` Rival: ${data.rivalHandle}.` : ''}
        </p>
        {stars.length ? (
          <ul className={v.stars} data-testid="v2-stars">
            {stars.map((s, i) => (
              <li key={s.title} data-got={(s.available !== false && s.met) || undefined} style={{ '--sd': `${600 + i * 220}ms` } as CSSProperties}>
                <i aria-hidden="true" />
                {s.title}
                {s.available === false ? <Soon what={`${s.title} check`} /> : <span className="sk-sr-only">{s.met ? ' · earned' : ' · missed'}</span>}
              </li>
            ))}
          </ul>
        ) : null}
        <div className={v.acts}>
          <ButtonLink variant="primary" href={again} data-testid="v2-again">
            {watch ? 'Back to the hub' : data.practice ? 'Practice again' : 'Queue again'}
          </ButtonLink>
          {onReplay ? (
            <Button onClick={onReplay} data-testid="v2-replay">
              Watch replay
            </Button>
          ) : replayHref ? (
            <ButtonLink href={replayHref} data-testid="v2-replay">
              Watch replay
            </ButtonLink>
          ) : null}
          <ButtonLink href={routes.market()}>Exchange</ButtonLink>
          <ButtonLink href={routes.home()}>Command</ButtonLink>
        </div>
      </div>
      <section className={`sk-panel ${v.tally}`} aria-label="Match report" data-testid="v2-tally">
        <span className="sk-kick">Match report</span>
        <div className={v.big}>
          <div>
            <span className="sk-kick">{data.ranked ? 'Elo' : 'Casual'}</span>
            <div className={v.bigN} data-neg={(data.eloDelta ?? 0) < 0 || undefined} data-testid="v2-elo">
              {data.ranked && data.eloDelta != null ? `${data.eloDelta >= 0 ? '+' : ''}${data.eloDelta}` : '—'}
            </div>
          </div>
          <div className={v.right}>
            <span className="sk-kick">MVP</span>
            <div className={v.mvp} data-testid="v2-mvp">
              {mvp?.name ?? '—'}
            </div>
          </div>
        </div>
        {d ? (
          <>
            {goal ? (
              <Row label={`${D.name} goal · ${goal.title}`}>
                {goal.available === false ? (
                  <Soon what="This goal's check" />
                ) : (
                  <b style={{ color: goal.met ? 'var(--you)' : 'var(--rival)' }}>
                    {goal.met ? 'Complete' : 'Missed'}
                    {goal.progress ? ` · ${goal.progress}` : ''}
                  </b>
                )}
              </Row>
            ) : null}
            <Row label="Messages sent">
              <b>{fmt(d.talk.sent)}</b>
            </Row>
            <Row label="Rival team chat your agents overheard">
              <b>{fmt(d.talk.overheard)}</b>
            </Row>
            <Row label="Bluffs told · believed by the rival">
              {d.bluffs ? (
                <b>
                  {fmt(d.bluffs.told)} · {fmt(d.bluffs.believed)}
                </b>
              ) : (
                <Soon what="Bluff stats" />
              )}
            </Row>
            <Row label="Rival bluffs · your agents saw through">
              {d.bluffs ? (
                <b>
                  {fmt(d.bluffs.heard)} · {fmt(d.bluffs.seenThrough)}
                </b>
              ) : (
                <Soon what="Bluff stats" />
              )}
            </Row>
            <Row label="Themed verbs used">
              <b>{fmt(verbs)}</b>
            </Row>
            <Row label={`Credits · ${r.ticks} ticks`}>
              <b data-testid="v2-credits">
                {fmt(d.credits.used)} of {fmt(d.credits.held)} held · {fmt(d.credits.returned)} back
              </b>
            </Row>
          </>
        ) : (
          <p className={v.note}>{watch ? 'Each crew’s report goes to its own player.' : 'The full report was not stored for this match.'}</p>
        )}
        <Row label="Season points">
          {d?.season ? (
            <b style={{ color: 'var(--amber)' }} data-testid="v2-season-points">
              +{fmt(d.season.points)} · Season {d.season.number}
            </b>
          ) : !d ? (
            <b>—</b>
          ) : data.ranked ? (
            // A ranked result stored before the points were recorded on the report.
            <Soon what="Season points" />
          ) : (
            <b data-testid="v2-season-points">Ranked only</b>
          )}
        </Row>
        <div className={v.verify} data-ok={data.registry === 'written' || undefined} data-testid="v2-registry">
          <span>
            {data.registry === 'written'
              ? `✓ Result · Elo · replay hash → ${registry}${data.txHash ? ` · tx ${data.txHash}` : ''}`
              : data.registry === 'pending'
                ? `Writing result · Elo · replay hash to ${registry}…`
                : data.registry === 'failed'
                  ? `The write to ${registry} failed; the result here stands`
                  : data.registry === 'local'
                    ? 'Recorded on this server only (NEAR is off here)'
                    : data.registry === 'casual'
                      ? 'Casual match · not written to the registry'
                      : 'Not written to the registry'}
          </span>
        </div>
        {data.logHash ? (
          <div className={v.verify}>
            <span>
              Match log hash <code data-testid="v2-hash">{data.logHash}</code> · action log, not a re-sim
            </span>
          </div>
        ) : null}
      </section>
      {data.comms ? <Transcript lines={data.comms} team={me} watch={watch} /> : null}
      {!watch && data.status === 'ended' ? <Decisions matchId={data.matchId} /> : null}
    </div>
  );
}

const CHANNEL: Record<string, string> = { team: 'Team', rteam: 'Team', say: 'Say', heard: 'Overheard' };

/** Every line said in the match as this tab saw it delivered, oldest first. */
function Transcript({ lines, team, watch }: { lines: V2CommsLine[]; team: DebriefData['team']; watch: boolean }) {
  return (
    <section className={`sk-panel ${v.transcript}`} aria-label="Comms" data-testid="v2-transcript">
      <span className="sk-kick">
        <b>Comms</b> · {watch ? 'both crews' : 'your crew, and rival talk your agents overheard'}
      </span>
      {lines.length ? (
        <ol className={v.lines}>
          {lines.map((l, i) => {
            const tag = feedTag(l, team);
            return (
              <li key={`${l.tick}|${l.from}|${i}`} style={{ '--c': l.team === team ? 'var(--you)' : 'var(--rival)' } as CSSProperties}>
                <span className={v.tk}>{clock((l.tick * TICK_MS) / 1000)}</span>
                <b>{l.fromName}</b>
                <span className={v.ch}>{CHANNEL[tag] ?? tag}</span>
                <span className={v.tx}>{l.text}</span>
                {l.overheardBy?.length ? <span className={v.heard}>overheard by {l.overheardBy.join(', ')}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={v.note}>Nobody spoke this match.</p>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={v.trow}>
      <span>{label}</span>
      {children}
    </div>
  );
}
