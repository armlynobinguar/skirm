'use client';
// The debrief's decision timeline ("why did it do that?"): pick an agent, scrub to a tick and read
// what it saw, the crew plan it read, what it did (and what the engine made of it), which equipped
// skill drove it and its inner voice. Key moments (hazard breaches, switches, supply drops,
// deliveries) are marked on the scrubber and listed under it. The live mind panel shows the latest
// mind; this is every tick after the match. Own crew only (practice adds the bot's). Skill text shows
// only for skills the player wrote, folded away.
import { TICK_MS } from '@skirm/engine/v2';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import type { DecisionCrew, MatchDecisions } from '@/lib/api/decisions';
import { qk } from '@/lib/api/queries';
import { useApi } from '@/lib/services';
import { MOMENT_LABEL, decisionAt, lastTick, markLeft, planAt, reasonNote, skillLine, stepMoment } from './hud/decisions';
import { clock } from './hud/model';
import d from './decisions.module.css';

export function Decisions({ matchId }: { matchId: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: qk.matches.v2Decisions(matchId), queryFn: () => api.v2MatchDecisions(matchId), retry: false });
  if (q.isPending)
    return (
      <section className={`sk-panel ${d.panel}`} aria-label="Decisions" aria-busy="true" data-testid="v2-decisions">
        <span className="sk-kick">Why did it do that?</span>
        <p className={d.note}>Loading the decision timeline…</p>
      </section>
    );
  const crews = q.data?.crews.filter((c) => c.decisions.length) ?? [];
  if (!q.data || !crews.length)
    return (
      <section className={`sk-panel ${d.panel}`} aria-label="Decisions" data-testid="v2-decisions">
        <span className="sk-kick">Why did it do that?</span>
        <p className={d.note} data-testid="v2-decisions-none">
          No decision timeline was kept for this match.
        </p>
      </section>
    );
  return <Timeline data={q.data} crews={crews} />;
}

function Timeline({ data, crews }: { data: MatchDecisions; crews: DecisionCrew[] }) {
  const [team, setTeam] = useState(crews.find((c) => c.own)?.team ?? crews[0]!.team);
  const crew = crews.find((c) => c.team === team) ?? crews[0]!;
  const end = lastTick(crew, data.ticks);
  const [agentId, setAgent] = useState(crew.agents[0]?.id ?? '');
  const [tick, setTick] = useState(1);
  const agent = crew.agents.find((a) => a.id === agentId) ?? crew.agents[0];
  const turn = agent ? decisionAt(crew.decisions, agent.id, tick) : null;
  const plan = planAt(crew.plans, tick);
  const ticksWithMoments = useMemo(() => {
    const by = new Map<number, typeof crew.moments>();
    for (const m of crew.moments) by.set(m.tick, [...(by.get(m.tick) ?? []), m]);
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }, [crew]);
  const skill = turn ? skillLine(turn, crew, data.skills) : null;
  const note = turn ? reasonNote(turn) : null;
  const jump = (t: number, who?: string | null) => {
    setTick(t);
    if (who && crew.agents.some((a) => a.id === who)) setAgent(who);
  };
  const pickCrew = (t: DecisionCrew['team']) => {
    setTeam(t);
    const c = crews.find((x) => x.team === t);
    setAgent(c?.agents[0]?.id ?? '');
  };
  const prev = stepMoment(crew.moments, tick, -1);
  const next = stepMoment(crew.moments, tick, 1);
  return (
    <section className={`sk-panel ${d.panel}`} aria-label="Decisions" data-testid="v2-decisions">
      <div className={d.head}>
        <span className="sk-kick">
          <b>Why did it do that?</b> · every tick, {crew.own ? 'your crew' : 'the greedy bot (practice shows all minds)'}
        </span>
        {crews.length > 1 ? (
          <div className={d.tabs} role="group" aria-label="Crew">
            {crews.map((c) => (
              <button key={c.team} type="button" className={d.tab} aria-pressed={c.team === crew.team} onClick={() => pickCrew(c.team)} data-testid={`v2-decisions-crew-${c.team}`}>
                {c.own ? 'Your crew' : 'Greedy bot'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={d.tabs} role="group" aria-label="Agent">
        {crew.agents.map((a) => (
          <button key={a.id} type="button" className={d.tab} aria-pressed={a.id === agent?.id} onClick={() => setAgent(a.id)} data-testid={`v2-decisions-agent-${a.id}`}>
            {a.name} <small>{a.role}</small>
          </button>
        ))}
      </div>
      <div className={d.scrub}>
        <div className={d.marks} aria-hidden="true">
          {ticksWithMoments.map(([t, ms]) => (
            <span
              key={t}
              className={d.mark}
              data-kind={ms[0]!.kind}
              data-rival={ms.every((m) => m.team !== crew.team) || undefined}
              style={{ '--x': `${markLeft(t, end)}%` } as CSSProperties}
              title={ms.map((m) => m.text).join(' · ')}
            />
          ))}
        </div>
        <input
          type="range"
          className={d.range}
          min={1}
          max={end}
          value={Math.min(tick, end)}
          onChange={(e) => setTick(Number(e.target.value))}
          aria-label="Tick"
          aria-valuetext={`Tick ${tick} of ${end}, ${clock((tick * TICK_MS) / 1000)}`}
          data-testid="v2-decisions-scrubber"
        />
        <div className={d.steps}>
          <button type="button" className={d.step} disabled={prev === null} onClick={() => prev !== null && jump(prev)} data-testid="v2-decisions-prev">
            ‹ Moment
          </button>
          <span className={d.at} data-testid="v2-decisions-tick">
            Tick {tick} · {clock((tick * TICK_MS) / 1000)}
          </span>
          <button type="button" className={d.step} disabled={next === null} onClick={() => next !== null && jump(next)} data-testid="v2-decisions-next">
            Moment ›
          </button>
        </div>
      </div>
      {turn && agent ? (
        <dl className={d.card} data-testid="v2-decisions-turn">
          {turn.tick !== tick ? <p className={d.note}>{agent.name} made no new move on this tick; this is its turn on tick {turn.tick}.</p> : null}
          <div>
            <dt>Saw</dt>
            <dd data-testid="v2-decisions-observed">{turn.observed || '—'}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd data-testid="v2-decisions-plan">
              {plan?.hidden ? (
                'Hidden: a skill this player did not write shaped the crew plan.'
              ) : plan?.text ? (
                <>
                  {plan.text}
                  {plan.why ? <span className={d.why}>Why · {plan.why}</span> : null}
                </>
              ) : (
                'No crew plan yet.'
              )}
            </dd>
          </div>
          <div>
            <dt>Did</dt>
            <dd data-testid="v2-decisions-action">
              <b>{turn.action}</b>
              {turn.outcome?.length ? ` → ${turn.outcome.join(', ')}` : ''}
              {note ? <span className={d.why}>{note}</span> : null}
            </dd>
          </div>
          <div>
            <dt>Skill</dt>
            <dd data-testid="v2-decisions-skill">
              {skill?.name ? (
                <>
                  <b className={d.chip}>{skill.name}</b> {skill.how}
                  {skill.skill?.mine && skill.skill.prompt ? (
                    <details className={d.mine}>
                      <summary>Your skill text</summary>
                      <p>{skill.skill.prompt}</p>
                    </details>
                  ) : null}
                </>
              ) : (
                skill?.how
              )}
            </dd>
          </div>
          {turn.said ? (
            <div>
              <dt>Said</dt>
              <dd>“{turn.said}”</dd>
            </div>
          ) : null}
          {turn.thought ? (
            <div>
              <dt>Inner voice</dt>
              <dd data-testid="v2-decisions-thought">{turn.thought}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className={d.note}>No turn recorded for this agent yet.</p>
      )}
      {ticksWithMoments.length ? (
        <ol className={d.moments} aria-label="Key moments" data-testid="v2-decisions-moments">
          {ticksWithMoments.flatMap(([t, ms]) =>
            ms.map((m, i) => (
              <li key={`${t}|${i}`} data-kind={m.kind} data-on={t === tick || undefined} style={{ '--c': m.team === crew.team ? 'var(--you)' : 'var(--rival)' } as CSSProperties}>
                <button type="button" onClick={() => jump(t, m.agentId)}>
                  <span className={d.at}>{clock((t * TICK_MS) / 1000)}</span>
                  <b>{MOMENT_LABEL[m.kind]}</b>
                  <span>{m.text}</span>
                </button>
              </li>
            )),
          )}
        </ol>
      ) : (
        <p className={d.note}>No key moments: no hazard reached the crew, no switch, supply drop or delivery.</p>
      )}
    </section>
  );
}
