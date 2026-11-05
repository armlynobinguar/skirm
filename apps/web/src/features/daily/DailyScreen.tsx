'use client';
// Daily challenge (/daily). One challenge per UTC day, the same for everyone: a map, a difficulty,
// the bot's crew and a twist, all derived from the date. Pick up to the bot's crew size of your
// agents and run them against the greedy bot; your best attempt counts on the global board.
// The board shows each attempt's log hash: on the greedy brain the same crew replays to it.
import { Badge, Button, Icon } from '@skirm/ui';
import { DIFF_MODS } from '@skirm/engine/v2';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RequireSession } from '@/components/shell/RequireSession';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { useMe } from '@/lib/api/queries';
import type { Agent, DailyAttempt, DailyBoard, DailyChallenge, DailyCrewAgent, DailyOutcome, DailyToday } from '@/lib/api/types';
import d from './daily.module.css';
import { dailyKeys, isOpen, useDaily, useDailyBoard, useStartDailyAttempt } from './hooks';

const OUTCOME: Record<DailyOutcome, { label: string; tone: 'good' | 'critical' | 'neutral' }> = {
  win: { label: 'Win', tone: 'good' },
  loss: { label: 'Loss', tone: 'critical' },
  draw: { label: 'Draw', tone: 'neutral' },
};

/** `hh:mm:ss` of a duration (never negative). */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** The first 10 hex chars of a log hash, for display. */
export const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 10) : '—');

const crewLine = (crew: DailyCrewAgent[]) => crew.map((a) => `${a.name} (${a.role})`).join(', ');

/** The last `n` UTC days ending at `date`, newest first. */
export function pastDays(date: string, n: number): string[] {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t - i * 86_400_000).toISOString().slice(0, 10));
}

export function DailyScreen() {
  return (
    <RequireSession>
      <Daily />
    </RequireSession>
  );
}

function Daily() {
  const today = useDaily();
  const qc = useQueryClient();
  // When an attempt finishes, the board may have moved.
  const open = today.data?.mine.filter(isOpen).length ?? 0;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open < wasOpen.current) void qc.invalidateQueries({ queryKey: ['daily', 'board'] });
    wasOpen.current = open;
  }, [open, qc]);

  return (
    <div className={d.page} data-testid="screen-daily">
      <section className={d.head}>
        <h1 className="app-h1">Daily challenge</h1>
        <p className={d.lede}>
          One seed a day for everyone. Run your crew against the greedy bot on today&apos;s map and twist; your best attempt
          goes on the global board.
        </p>
      </section>
      <QueryView query={today} loading={<Skeleton rows={6} label="Loading today's challenge" />}>
        {(t) => (
          <>
            <ChallengeCard challenge={t.challenge} endsAt={t.endsAt} msLeft={t.msLeft} onRollover={() => void qc.invalidateQueries({ queryKey: dailyKeys.all })} />
            <RunPanel today={t} />
            <Attempts attempts={t.mine} />
            <Board today={t.challenge.date} />
          </>
        )}
      </QueryView>
    </div>
  );
}

function ChallengeCard({ challenge: c, endsAt, msLeft, onRollover }: { challenge: DailyChallenge; endsAt: string; msLeft: number; onRollover: () => void }) {
  // Counts down to the end of the UTC day from the server's figure, then reloads the new challenge.
  const [left, setLeft] = useState(msLeft);
  const rollover = useRef(onRollover);
  rollover.current = onRollover;
  useEffect(() => {
    const end = Date.now() + msLeft;
    setLeft(msLeft);
    const id = setInterval(() => {
      const l = end - Date.now();
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        rollover.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [msLeft, endsAt]);

  return (
    <section className={d.panel} aria-label="Today's challenge" data-testid="daily-challenge">
      <div className={d.cardHead}>
        <div>
          <span className="sk-kick">{c.date} · seed {c.seed}</span>
          <h2 className={d.h2}>{c.mapName}</h2>
        </div>
        <div className={d.timer} aria-live="off">
          <span className="sk-kick">Next challenge in</span>
          <span className={d.clock} data-testid="daily-countdown">
            {countdown(left)}
          </span>
        </div>
      </div>
      <dl className={d.facts}>
        <div>
          <dt>Difficulty</dt>
          <dd>{DIFF_MODS[c.difficulty]?.name ?? c.difficulty}</dd>
        </div>
        <div>
          <dt>Twist</dt>
          <dd data-testid="daily-twist">{c.twistName}</dd>
        </div>
        <div>
          <dt>Bot crew</dt>
          <dd>{c.crewSize}</dd>
        </div>
        <div>
          <dt>Clock</dt>
          <dd>{c.ticks} ticks</dd>
        </div>
      </dl>
      <p className={d.note}>{c.twistLine}.</p>
    </section>
  );
}

function RunPanel({ today: t }: { today: DailyToday }) {
  const me = useMe();
  const toast = useToast();
  const start = useStartDailyAttempt();
  const agents: Agent[] = useMemo(() => me.data?.agents ?? [], [me.data]);
  const size = t.challenge.crewSize;
  const [picked, setPicked] = useState<string[] | null>(null);
  const crew = picked ?? agents.slice(0, size).map((a) => a.id);
  const toggle = (id: string) =>
    setPicked(crew.includes(id) ? crew.filter((x) => x !== id) : crew.length < size ? [...crew, id] : crew);
  const out = t.attempts.left <= 0;

  const run = () =>
    start.mutate(crew, {
      onSuccess: () => toast.show({ tone: 'good', title: 'Attempt queued', message: `${t.challenge.mapName} against the greedy bot` }),
      onError: (err) => toast.error(err),
    });

  return (
    <section className={d.panel} aria-label="Your run">
      <h2 className={d.h2}>Your crew</h2>
      <div className={`app-banner${t.free ? '' : ' is-warning'}`} role="note" data-testid="daily-cost">
        <Icon name="info" size={16} />
        <span>
          {t.free
            ? 'Free here: the offline greedy brain plays your crew.'
            : `Each attempt plays your crew with the model and holds up to ${t.costCredits} credits (free allowance first); what it does not use comes back.`}{' '}
          {t.attempts.left} of {t.attempts.perDay} attempts left today.
        </span>
      </div>
      {agents.length === 0 ? (
        <p className="sk-muted">{me.isLoading ? 'Loading your agents…' : 'You have no agents yet.'}</p>
      ) : (
        <fieldset className={d.crew}>
          <legend className={d.note}>
            Pick 1 to {size} agent{size === 1 ? '' : 's'} (the bot fields {size}).
          </legend>
          {agents.map((a) => (
            <label key={a.id} className={d.pick}>
              <input
                type="checkbox"
                checked={crew.includes(a.id)}
                disabled={!crew.includes(a.id) && crew.length >= size}
                onChange={() => toggle(a.id)}
                data-testid={`daily-agent-${a.id}`}
              />
              {a.name} <span className="sk-muted">{a.role}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className={d.actions}>
        <Button variant="primary" onClick={run} disabled={out || crew.length === 0 || start.isPending} data-testid="daily-run">
          {out ? 'No attempts left today' : start.isPending ? 'Queueing…' : 'Run the challenge'}
        </Button>
      </div>
    </section>
  );
}

function StatusBadge({ a }: { a: DailyAttempt }) {
  if (a.status === 'done' && a.outcome) {
    const o = OUTCOME[a.outcome];
    return (
      <Badge tone={o.tone} data-testid={`daily-outcome-${a.id}`}>
        {o.label}
      </Badge>
    );
  }
  const label = a.status === 'queued' ? 'Queued' : a.status === 'running' ? 'Playing' : a.status === 'insufficient_credits' ? 'Needs credits' : 'Failed';
  return (
    <Badge tone={a.status === 'failed' || a.status === 'insufficient_credits' ? 'warning' : 'neutral'} icon={false} data-testid={`daily-outcome-${a.id}`}>
      {label}
    </Badge>
  );
}

function Attempts({ attempts }: { attempts: DailyAttempt[] }) {
  return (
    <section className={d.panel} aria-label="Your attempts">
      <h2 className={d.h2}>Your attempts today</h2>
      {attempts.length === 0 ? (
        <p className="sk-muted">No attempts yet.</p>
      ) : (
        <ul className={d.list} data-testid="daily-attempts">
          {attempts.map((a) => (
            <li key={a.id} className={d.row} data-testid={`daily-attempt-${a.id}`}>
              <div className={d.rowMeta}>
                <span>
                  <StatusBadge a={a} /> {a.points !== null ? <b className={d.points}>{a.points.toLocaleString('en-US')} pts</b> : null}
                </span>
                <span className={d.sub}>
                  {a.result ? `${a.result.score.you}–${a.result.score.bot} · ${a.result.ticks} of ${a.result.clock} ticks · ` : ''}
                  {crewLine(a.crew)}
                  {a.shortfall ? ` · needs ${a.shortfall.need} credits, you have ${a.shortfall.have}` : ''}
                </span>
              </div>
              <code className={d.hash} title={a.logHash ?? undefined}>
                {shortHash(a.logHash)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Board({ today }: { today: string }) {
  const [date, setDate] = useState<string | null>(null);
  const board = useDailyBoard(date);
  const days = useMemo(() => pastDays(today, 7), [today]);
  return (
    <section className={d.panel} aria-label="Global board">
      <div className={d.cardHead}>
        <h2 className={d.h2}>Global board</h2>
        <label className={d.dateLabel}>
          Day
          <select className={d.select} value={date ?? today} onChange={(e) => setDate(e.target.value === today ? null : e.target.value)} data-testid="daily-board-date">
            {days.map((x) => (
              <option key={x} value={x}>
                {x === today ? `Today (${x})` : x}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={d.note}>
        Points: win 10,000, draw 5,000, loss 0; plus 100 per point of score margin (up to ±20); plus ticks left on the clock
        when you win (up to 99). Ties go to fewer ticks, then to whoever finished first.
      </p>
      <QueryView
        query={board}
        loading={<Skeleton rows={4} label="Loading the board" />}
        empty={(b) => b.top.length === 0 && <p className="sk-muted">Nobody has finished an attempt on this day yet.</p>}
      >
        {(b) => <BoardTable board={b} />}
      </QueryView>
    </section>
  );
}

function BoardTable({ board: b }: { board: DailyBoard }) {
  const mine = b.me && !b.top.some((r) => r.you) ? b.me : null;
  const rows = mine ? [...b.top, mine] : b.top;
  return (
    <div className={d.tableWrap}>
      <table className={d.table} data-testid="daily-board">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Crew</th>
            <th scope="col" className={d.num}>Points</th>
            <th scope="col">Result</th>
            <th scope="col" className={d.num}>Ticks</th>
            <th scope="col">Log hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.attemptId} className={r.you ? d.you : undefined} data-testid={`daily-board-row-${r.rank}`}>
              <td className={d.num}>{r.rank}</td>
              <td>
                {r.handle}
                {r.you ? <span className="sk-muted"> (you)</span> : null}
              </td>
              <td className={d.sub}>{crewLine(r.crew)}</td>
              <td className={d.num}>{r.points.toLocaleString('en-US')}</td>
              <td>{OUTCOME[r.outcome]?.label ?? r.outcome}</td>
              <td className={d.num}>{r.ticks}</td>
              <td>
                <code className={d.hash} title={r.logHash}>
                  {shortHash(r.logHash)}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={d.note}>
        {b.players} player{b.players === 1 ? '' : 's'} on {b.date}
        {b.me ? ` · you are #${b.me.rank}` : ''}.
      </p>
    </div>
  );
}
