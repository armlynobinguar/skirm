'use client';
// Third person on one agent (the prototype's enterTPV / renderTpv / buildMind / subtitles): who it
// is with its inventory on the left, its mind on the right, and subtitles of what it does, says and
// hears. The mind shows your own agent's plan as the server sent it, the planner's reason for it
// (planner trace) and the agent's inner voice this tick; "Plan hidden" for an agent on a bought skill
// (so a skill never leaks through plan text), and nothing for a rival except in practice, where the
// server sends the bot's mind too. Story pace keeps
// every subtitle up for its full time; without it only the last three wait their turn.
import { carryOf, mapV2, type FrameAgent, type Team } from '@skirm/engine/v2';
import { Button } from '@skirm/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { mapById } from '@/features/arena/world';
import { usePreferences } from '@/lib/preferences';
import type { V2CommsLine } from '../v2Store';
import c from './hud.module.css';
import { heardBy, slotsOf, subtitlesFor, type Sub } from './model';
import { MindSkills } from './MindSkills';
import { BigSlots, Ear } from './parts';

export interface ThirdPersonProps {
  agent: FrameAgent;
  team: Team;
  ranked: boolean;
  mapId: string;
  /** In this crew's sight (a rival out of sight shows "?" slots). */
  inSight: boolean;
  tick: number;
  limit: number;
  tickMs: number;
  lines: V2CommsLine[];
  /** Your crew playbook's name this match (your own frames only); shown in your agents' minds. */
  playbook?: string | null;
  story: boolean;
  /** Subtitles are waiting on story pace. */
  onHeld: (held: boolean) => void;
  onExit: () => void;
}

const TIER_NAME = { quiet: 'Quiet', standard: 'Standard', open: 'Open' } as const;

export function ThirdPerson({ agent, team, ranked, mapId, inSight, tick, limit, tickMs, lines, playbook, story, onHeld, onExit }: ThirdPersonProps) {
  const rival = agent.team !== team;
  const colour = rival ? 'var(--rival)' : 'var(--you)';
  const def = mapV2(mapId);
  const item = def?.item ?? 'Item';
  const accent = (mapById(mapId) as unknown as { pal?: { accent: string } } | undefined)?.pal?.accent ?? 'var(--amber)';
  const slots = carryOf(agent.role);
  const status = agent.out ? 'Out' : agent.down ? 'Swept' : 'Active';
  const subs = useSubtitles(agent, team, ranked, lines, tick, story);
  useEffect(() => onHeld(subs.held), [subs.held, onHeld]);
  useEffect(() => () => onHeld(false), [onHeld]);
  return (
    <>
      <div className={`sk-panel ${c.tpid}`} data-testid="v2-tpv">
        <span className="sk-kick">Third person · {rival ? <span className={c.r}>rival crew</span> : <b>your crew</b>}</span>
        <span className={c.tpName} style={{ color: colour }}>
          {agent.name}
        </span>
        <span className="sk-kick">
          {agent.role} · {TIER_NAME[agent.tier]} talk
        </span>
        <span className={c.tpst} style={{ '--c': colour } as CSSProperties}>
          <span>{status}</span>
          <span>{inSight ? 'in sight' : 'out of sight'}</span>
          <span>{agent.delivered} dlv</span>
        </span>
        <div className={c.tpinv}>
          <span className="sk-kick">
            Inventory · {inSight ? agent.items.length : '?'}/{slots}
          </span>
          <BigSlots slots={slotsOf(agent, slots, inSight, tick)} mapId={mapId} item={item} accent={accent} limit={limit} tickMs={tickMs} />
        </div>
        <Button size="sm" onClick={onExit} data-testid="v2-tpv-exit">
          Exit view · Esc
        </Button>
      </div>
      <Mind agent={agent} team={team} ranked={ranked} lines={lines} playbook={agent.team === team ? (playbook ?? null) : null} />
      <div className={c.subs} aria-live="polite" data-testid="v2-subs">
        {subs.prev ? <SubLine key={`p${subs.n - 1}`} s={subs.prev} state="prev" /> : null}
        {subs.cur ? <SubLine key={`c${subs.n}`} s={subs.cur} state="enter" /> : null}
      </div>
    </>
  );
}

function Mind({ agent, team, ranked, lines, playbook }: { agent: FrameAgent; team: Team; ranked: boolean; lines: V2CommsLine[]; playbook: string | null }) {
  const rival = agent.team !== team;
  // The server sends a rival's mind only in practice (the prototype: practice shows all minds).
  const open = !rival || !!(agent.plan || agent.planWhy || agent.thought);
  const heard = heardBy(lines, agent, team);
  const plan = useTyped(open && !agent.planHidden ? (agent.plan ?? '') : '');
  return (
    <aside className={`sk-panel ${c.mind}`} aria-label="Agent mind" data-testid="v2-mind">
      <div className={c.mh}>
        <span className="sk-kick">
          <b style={{ color: rival ? 'var(--rival)' : 'var(--you)' }}>Mind</b> · {agent.name}
        </span>
        {rival ? <span className="sk-kick">{ranked ? 'Ranked' : 'Casual'}</span> : <span className="sk-kick">{TIER_NAME[agent.tier]} talk</span>}
      </div>
      {rival && !open ? (
        <div className={c.hid} data-testid="v2-mind-private">
          {ranked ? 'Private in ranked.' : 'A rival’s plan stays private.'} You see what {agent.name} says aloud and what your crew overhears.
        </div>
      ) : (
        <section>
          {rival ? (
            <p className={c.hid} data-testid="v2-mind-practice">
              Practice: you see the bot’s mind. In ranked and against players, a rival’s mind stays private.
            </p>
          ) : null}
          {playbook ? (
            <p className={c.hid} data-testid="v2-mind-playbook">
              Playbook: <b>{playbook}</b>
            </p>
          ) : null}
          <h3>
            Plan <em>its last turn</em>
          </h3>
          {agent.planHidden ? (
            <div className={c.hid} data-testid="v2-plan-hidden">
              Plan hidden — bought skill. An agent on an encrypted skill keeps its plan to itself, so the skill never shows here.
            </div>
          ) : (
            <div className={c.thk} data-testid="v2-plan">
              {agent.plan ? plan : 'No plan reported yet.'}
            </div>
          )}
          {!agent.planHidden && agent.planWhy ? (
            <>
              <h3>
                Why <em>planner trace</em>
              </h3>
              <div className={c.thk} data-testid="v2-plan-why">
                {agent.planWhy}
              </div>
            </>
          ) : null}
          <h3>
            Inner voice <em>this tick</em>
          </h3>
          <div className={c.thk} data-testid="v2-thought">
            {agent.thought ? `“${agent.thought}”` : agent.planHidden ? 'Kept to itself: bought skill.' : 'Nothing said to itself yet.'}
          </div>
        </section>
      )}
      {rival ? null : <MindSkills skills={agent.skills} />}
      <section>
        <h3>{rival ? 'Said aloud' : 'Heard'}</h3>
        <div className={c.heard}>
          {heard.length ? (
            heard.map((l, i) => (
              <p key={`${l.tick}-${l.from}-${i}`}>
                {l.overheard ? (
                  <em title="Overheard">
                    <Ear />
                  </em>
                ) : null}
                <b style={{ '--c': l.team === team ? 'var(--you)' : 'var(--rival)' } as CSSProperties}>{l.fromName}</b>
                {l.text}
              </p>
            ))
          ) : (
            <p>Nothing in range yet.</p>
          )}
        </div>
      </section>
    </aside>
  );
}

function SubLine({ s, state }: { s: Sub; state: 'prev' | 'enter' }) {
  const colour = s.team == null ? 'var(--amber)' : s.team === 'A' ? 'var(--you)' : 'var(--rival)';
  const who =
    s.kind === 'think' ? (
      `${s.who} · thinking`
    ) : s.kind === 'verb' ? (
      `${s.who} · action`
    ) : s.kind === 'arena' ? (
      'Arena'
    ) : (
      <>
        {s.who} · {s.ch === 'overheard' ? <Ear /> : s.ch}
      </>
    );
  const quoted = s.kind === 'say' || s.kind === 'heard';
  return (
    <div className={c.sub} data-kind={s.kind} data-prev={state === 'prev' || undefined} data-enter={state === 'enter' || undefined}>
      <span className={c.sw} style={{ '--c': colour } as CSSProperties}>
        {who}
      </span>
      {quoted ? `“${s.text}”` : s.text}
    </div>
  );
}

interface SubState {
  cur: Sub | null;
  prev: Sub | null;
  /** Wall ms the current line went up. */
  at: number;
  n: number;
}

/**
 * The subtitle queue for the watched agent: each tick's lines join the queue, one shows at a time
 * for its length, the one before it fades above. Off story pace the queue keeps only three.
 */
function useSubtitles(agent: FrameAgent, team: Team, ranked: boolean, lines: V2CommsLine[], tick: number, story: boolean) {
  const queue = useRef<Sub[]>([]);
  const [shown, setShown] = useState<SubState>({ cur: null, prev: null, at: 0, n: 0 });
  const [queued, setQueued] = useState(0);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const storyRef = useRef(story);
  storyRef.current = story;

  // A new agent starts clean, with what it is thinking now.
  useEffect(() => {
    const a = agentRef.current;
    queue.current = a.plan && a.team === team && !a.planHidden ? subtitlesFor([{ tick: 0, from: a.id, fromName: a.name, team: a.team, channel: 'mind', text: a.plan, overheard: false }], a, team, ranked) : [];
    setShown((s) => ({ cur: null, prev: null, at: 0, n: s.n + 1 }));
    setQueued(queue.current.length);
  }, [agent.id, team, ranked]);

  // Each tick adds its lines.
  useEffect(() => {
    const fresh = subtitlesFor(
      linesRef.current.filter((l) => l.tick === tick),
      agentRef.current,
      team,
      ranked,
    );
    if (!fresh.length) return;
    queue.current.push(...fresh);
    if (!storyRef.current && queue.current.length > 3) queue.current.splice(0, queue.current.length - 3);
    setQueued(queue.current.length);
  }, [tick, team, ranked]);

  // Show the next line when the current one has had its time (and clear the screen after a pause).
  useEffect(() => {
    const next = () => {
      const nx = queue.current.shift();
      setQueued(queue.current.length);
      setShown((s) => (nx ? { cur: nx, prev: s.cur, at: Date.now(), n: s.n + 1 } : { cur: null, prev: null, at: 0, n: s.n }));
    };
    if (!shown.cur) {
      if (queue.current.length) next();
      return;
    }
    const wait = shown.at + (shown.cur.dur + (queue.current.length ? 0 : 1.5)) * 1000 - Date.now();
    const t = setTimeout(next, Math.max(0, wait));
    return () => clearTimeout(t);
  }, [shown, queued]);

  return { ...shown, held: story && queued > 0 };
}

/** Types the text out two characters every 16 ms (all at once with reduced motion). */
function useTyped(text: string): string {
  const { reducedMotion } = usePreferences();
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (reducedMotion || !text) {
      setN(text.length);
      return;
    }
    setN(0);
    const iv = setInterval(() => {
      setN((k) => {
        if (k + 2 >= text.length) clearInterval(iv);
        return Math.min(text.length, k + 2);
      });
    }, 16);
    return () => clearInterval(iv);
  }, [text, reducedMotion]);
  return text.slice(0, n);
}
