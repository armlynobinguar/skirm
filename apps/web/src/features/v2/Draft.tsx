'use client';
// v2 match, draft mode: the ban phase between accept and lock-in. Each crew in turn bans one of the
// rival's equipped skills, shown by its public name only (never its text); the banned skill is off
// the rival crew for this match. On your step: pick a skill or pass before the clock runs out (the
// server passes for you at 0). The rival's step and every ban so far show as they land; when the last
// step is played the server moves both crews to lock-in.
import type { Team } from '@skirm/engine/v2';
import { Button } from '@skirm/ui';
import { useState } from 'react';
import { mapById } from '@/features/arena/world';
import type { V2DraftBan } from '@/lib/realtime/protocol';
import { useRealtime } from '@/lib/services';
import { Countdown, other } from './common';
import v from './v2.module.css';
import type { V2MatchView } from './v2Store';

export function Draft({ view }: { view: V2MatchView }) {
  const rt = useRealtime();
  const map = mapById(view.mapId);
  const d = view.draft;
  // The step this tab already answered (the server's next v2_draft moves on).
  const [sentStep, setSentStep] = useState<number | null>(null);
  const mine = !!d && d.turn === view.team && sentStep !== d.step;
  const ban = (skillId: string | null) => {
    if (!d || !mine) return;
    rt.send({ type: 'v2_ban', matchId: view.matchId, skillId });
    setSentStep(d.step);
  };
  const status = !d || (d.turn === null && !d.done) ? 'The draft is starting…' : d.done ? 'Draft over · lock-in is next' : d.turn === view.team ? (mine ? 'Your ban' : 'Ban sent…') : 'The rival is banning';
  return (
    <div className={v.draft} data-testid="v2-draft">
      <header className={v.draftHead}>
        <div>
          <span className="sk-kick">
            Draft · casual · {map?.name ?? view.mapId}
            {d && d.steps ? ` · ban ${Math.min(d.step + 1, d.steps)} of ${d.steps}` : ''}
          </span>
          <h1 className="sk-disp" data-testid="v2-draft-status">
            {status}
          </h1>
        </div>
        {d?.by != null ? (
          <span role="timer" aria-label="Seconds left for this ban">
            <Countdown until={d.by} />
          </span>
        ) : null}
      </header>
      <p className={v.note}>
        Ban one skill the rival crew has equipped; it is unequipped from every rival agent for this match. You see only skill names. A step with no answer passes.
      </p>
      <section aria-label="Rival skills">
        <span className="sk-kick">Rival skills</span>
        {d?.pool.length ? (
          <ul className={v.pool} data-testid="v2-draft-pool">
            {d.pool.map((s) => (
              <li key={s.skillId}>
                <button type="button" className={v.banPick} disabled={!mine} onClick={() => ban(s.skillId)} data-testid={`v2-ban-${s.skillId}`}>
                  <b>{s.name}</b>
                  <small>
                    {s.agents} rival agent{s.agents === 1 ? '' : 's'} · {mine ? 'Ban' : 'Bannable on your turn'}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={v.note}>The rival has no skills left to ban.</p>
        )}
      </section>
      {mine ? (
        <div className={v.row}>
          <Button variant="ghost" onClick={() => ban(null)} data-testid="v2-ban-pass">
            Pass
          </Button>
        </div>
      ) : null}
      <BanList bans={d?.bans ?? []} team={view.team} />
    </div>
  );
}

/** Every ban step so far, yours and the rival's (also on the debrief). */
export function BanList({ bans, team, watch = false }: { bans: V2DraftBan[]; team: Team; watch?: boolean }) {
  if (!bans.length) return null;
  const who = (t: Team) => (watch ? `Crew ${t}` : t === team ? 'You' : 'Rival');
  return (
    <section aria-label="Bans" data-testid="v2-bans">
      <span className="sk-kick">Bans</span>
      <ol className={v.bans}>
        {bans.map((b) => (
          <li key={b.step} data-you={(!watch && b.team === team) || undefined} data-rival={(!watch && b.team === other(team)) || undefined}>
            <b>{who(b.team)}</b>
            <span>{b.skillId ? `banned ${b.name ?? b.skillId}` : b.timedOut ? 'ran out of time · passed' : 'passed'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
