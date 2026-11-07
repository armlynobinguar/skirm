'use client';
// The map entrance before a live match (the prototype's runIntro): the map's name, the objective
// and goal, the hazard warning (a flash and a shake as the hazards rise in), then both crews as name
// cards: yours slide in from the left ("ROOK · Builder · Flood Warden": name, role, first equipped
// skill), the rival's from the right with only what this crew's frames show (a seen rival's name and
// role; the rest "unseen"). Under it the camera sweeps across the map in close and settles on the
// board as the crews land (arena/scene.ts setIntroSweep); with reduced motion there is no sweep and
// nothing slides. Skip with the button, Enter, Space or Esc. The match itself is server-paced and
// already running underneath; the HUD fades in when the intro ends.
import { BOT_HANDLE, DIFF_MODS, mapV2, type Difficulty } from '@skirm/engine/v2';
import { Button, HazardTape } from '@skirm/ui';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { setLiveFx } from '@/features/arena/live';
import { INTRO_SWEEP_MS, setIntroSweep } from '@/features/arena/scene';
import { mapById } from '@/features/arena/world';
import { usePreferences } from '@/lib/preferences';
import type { FrameAgent } from '@/lib/realtime/protocol';
import { useRealtime } from '@/lib/services';
import { v2StoreFor } from '../v2Store';
import c from './hud.module.css';
import s from './intro.module.css';
import { clock, goalTag, plural } from './model';

/** The hazard card's headline per map. */
const HAZ_HEAD: Readonly<Record<string, string>> = {
  'saltmarsh-weir': 'The weir breaks',
  'ashfall-orchard': 'The orchard catches',
  'frostline-depot': 'The depot freezes shut',
  'glasshouse-ruins': 'The boiler blows',
  'copper-hollow': 'The shaft floods',
  'dust-bowl-silos': 'The grain ignites',
  'monsoon-terraces': 'The gates burst',
  'sunken-metro': 'The tunnels flood',
  'basalt-stair': 'The vent wakes',
  'blackout-harbor': 'The storm hits',
};
const HAZ_COL: Readonly<Record<string, string>> = { water: 'var(--water)', fire: 'var(--fire)', lava: 'var(--lava)' };
const TIER_NAME = { quiet: 'Quiet', standard: 'Standard', open: 'Open' } as const;

/** When each card comes up (ms from the start), and when the intro hands over (the crews land as the sweep settles). */
export const INTRO_MS = { title: 200, goal: 1700, hazard: 3300, crews: INTRO_SWEEP_MS, done: 7800 } as const;

/** Most name cards a side shows; the rest fold into "+N more". */
const MAX_CARDS = 6;

/** One agent's name card: only what the intro knows (a rival's role and skill only when its frames carry them). */
export interface IntroCard {
  key: string;
  name: string;
  role: string | null;
  skill: string | null;
  /** A rival agent this crew has not seen: no name, no role. */
  unseen?: true;
}

const cardOf = (a: FrameAgent): IntroCard => ({ key: a.id, name: a.name, role: a.role, skill: a.skills?.[0]?.name ?? null });

/** Your crew's cards: from the frame's agents when there, else the names alone. */
export function crewCards(names: readonly string[], agents: readonly FrameAgent[] | null | undefined): IntroCard[] {
  if (agents?.length) return agents.map(cardOf);
  return names.map((n, i) => ({ key: `n${i}`, name: n, role: null, skill: null }));
}

/** The rival's cards: the agents seen so far as seen, then one "unseen" card per agent still hidden. */
export function rivalCards(seen: readonly FrameAgent[] | null | undefined, count: number | null): IntroCard[] {
  const known = (seen ?? []).map(cardOf);
  const hidden = Math.max(0, (count ?? 0) - known.length);
  return [...known, ...Array.from({ length: hidden }, (_, i): IntroCard => ({ key: `u${i}`, name: 'Rival', role: null, skill: null, unseen: true }))];
}

/** This tab's live player view of the match on this map, for the cards' roles and skills (none: names only). */
function useIntroView(mapId: string) {
  const store = v2StoreFor(useRealtime());
  const view = useSyncExternalStore(
    (l) => store.subscribe(l),
    () => (store.current ? store.get(store.current) : undefined),
    () => undefined,
  );
  return view && view.mapId === mapId && !view.watch && view.phase === 'live' ? view : undefined;
}

function Cards({ cards, side }: { cards: IntroCard[]; side: 'A' | 'B' }) {
  const shown = cards.slice(0, MAX_CARDS);
  const more = cards.length - shown.length;
  return (
    <ol className={`${s.col} ${side === 'A' ? s.colA : s.colB}`} aria-label={side === 'A' ? 'Your crew' : 'Rival crew'}>
      {shown.map((k, i) => (
        <li key={k.key} className={`${s.card} ${k.unseen ? s.unseen : ''}`} style={{ '--i': i } as CSSProperties} data-testid="v2-intro-card">
          <span className={s.name}>{k.name}</span>
          <span className={s.meta}>
            {k.unseen ? (
              'unseen'
            ) : (
              <>
                {k.role ? <b>{k.role}</b> : null}
                {k.role && k.skill ? ' · ' : null}
                {k.skill}
              </>
            )}
          </span>
        </li>
      ))}
      {more > 0 ? (
        <li className={s.more} style={{ '--i': shown.length } as CSSProperties}>
          +{more} more
        </li>
      ) : null}
    </ol>
  );
}

export interface IntroProps {
  mapId: string;
  ranked: boolean;
  difficulty: Difficulty;
  /** Items to deliver and the clock, from the first frame. */
  goal: number;
  limit: number;
  tickMs: number;
  you: string | null;
  rivalHandle: string | null;
  crew: string[];
  rivalAgents: number | null;
  /** Your crew's agents (role and skills); absent: read from this tab's live view of the match. */
  agents?: readonly FrameAgent[];
  /** The rival agents this crew has seen; absent: read from this tab's live view. */
  rivals?: readonly FrameAgent[];
  /** Practice against the greedy bot; absent: read from this tab's live view. */
  practice?: boolean;
  onDone: () => void;
}

export function Intro({ mapId, ranked, difficulty, goal, limit, tickMs, you, rivalHandle, crew, rivalAgents, onDone, ...known }: IntroProps) {
  const [step, setStep] = useState<'' | keyof typeof INTRO_MS>('');
  const [flash, setFlash] = useState(0);
  const { reducedMotion } = usePreferences();
  const still = useRef(reducedMotion);
  const done = useRef(onDone);
  done.current = onDone;
  const view = useIntroView(mapId);
  const own = known.agents ?? view?.frame?.agents.filter((a) => a.team === view.team);
  const rivalsSeen = known.rivals ?? view?.rivals;
  const practice = known.practice ?? view?.practice ?? false;
  useEffect(() => {
    setLiveFx({ intro: true, revealAt: null, deployAt: null, shakeAt: null });
    // The camera sweep runs from the first frame (never with reduced motion: the camera just sits).
    if (!still.current) setIntroSweep(Date.now());
    const at = (ms: number, f: () => void) => setTimeout(f, ms);
    const ts = [
      at(INTRO_MS.title, () => setStep('title')),
      at(INTRO_MS.goal, () => setStep('goal')),
      at(INTRO_MS.hazard, () => {
        const now = Date.now();
        setLiveFx({ revealAt: now, shakeAt: now });
        setFlash((n) => n + 1);
        setStep('hazard');
      }),
      at(INTRO_MS.crews, () => {
        setLiveFx({ deployAt: Date.now() });
        setStep('crews');
      }),
      at(INTRO_MS.done, () => done.current()),
    ];
    return () => {
      ts.forEach(clearTimeout);
      setIntroSweep(null);
    };
  }, []);

  const def = mapV2(mapId);
  const look = mapById(mapId);
  const tag = goalTag(mapId, difficulty);
  const D = DIFF_MODS[difficulty];
  const item = def?.item ?? 'Item';
  const hz = def?.hazards[0]?.kind;
  const rivalName = rivalHandle ?? (practice ? BOT_HANDLE : null);
  return (
    <div className={`${c.intro} ${reducedMotion ? s.still : ''}`} data-testid="v2-intro">
      {flash ? <div key={flash} className={c.flash} aria-hidden="true" /> : null}
      <div className={c.icard} aria-live="polite">
        {step === 'title' ? (
          <div key="title" className={c.ic}>
            <span className={`sk-kick ${c.x}`} style={{ '--i': 0 } as CSSProperties}>
              {def?.code} · {def?.region} · {look ? `${look.A.w}×${look.A.h}` : ''}
            </span>
            <span className={`${c.huge} ${c.x}`} style={{ '--i': 1 } as CSSProperties}>
              {def?.name ?? mapId}
            </span>
            <span className={`${c.dtag} ${c.x}`} style={{ '--i': 2, '--dc': D.colour } as CSSProperties}>
              {D.name} · {ranked ? 'ranked' : 'casual'}
            </span>
          </div>
        ) : step === 'goal' ? (
          <div key="goal" className={c.ic}>
            <span className={`sk-kick ${c.x}`} style={{ '--i': 0, color: D.colour } as CSSProperties}>
              Objective
            </span>
            <span className={`${c.huge} ${c.x}`} style={{ '--i': 1 } as CSSProperties}>
              Deliver {goal} {plural(item, goal)}
            </span>
            <span className={`${c.midline} ${c.x}`} style={{ '--i': 2 } as CSSProperties}>
              to the {(def?.deliverTo ?? 'exit').toLowerCase()}
            </span>
            <span className={`${c.isub} ${c.x}`} style={{ '--i': 3 } as CSSProperties}>
              <span className={c.dtag} style={{ '--dc': tag.colour } as CSSProperties}>
                {tag.name}
              </span>
              <b>{tag.title}</b>
              <span>{tag.text}</span>
            </span>
            <span className={`${c.rule} ${c.x}`} style={{ '--i': 4 } as CSSProperties}>
              First crew to {goal} wins · {clock((limit * tickMs) / 1000)} on the clock
            </span>
          </div>
        ) : step === 'hazard' ? (
          <div key="hazard" className={`${c.ic} ${c.haz}`} style={{ '--hz': (hz && HAZ_COL[hz]) || 'var(--bone)' } as CSSProperties}>
            <HazardTape className={c.tape} />
            <span className={`sk-kick ${c.x}`} style={{ '--i': 1, color: 'var(--amber)' } as CSSProperties}>
              Warning
            </span>
            <span className={c.huge}>{HAZ_HEAD[mapId] ?? 'Hazard'}</span>
            <span className={`sk-kick ${c.x}`} style={{ '--i': 2, letterSpacing: '.2em' } as CSSProperties}>
              {look?.pressure}
              {def?.switches.length ? ` · ${def.switches.length} switch${def.switches.length > 1 ? 'es' : ''} in the middle` : ''}
              {def?.fog || D.fog ? ' · fog' : ''}
            </span>
            <HazardTape className={c.tape} />
          </div>
        ) : step === 'crews' ? (
          <div key="crews" className={`${c.ic} ${s.crews}`} data-testid="v2-intro-crews">
            <div className={s.head}>
              <span className={`sk-kick ${s.headA}`}>
                <b>You</b>
                {you ? ` · ${you}` : ''}
              </span>
              <span className={s.vs}>VS</span>
              <span className={`sk-kick ${s.headB}`}>
                <span className={c.r}>Rival</span>
                {rivalName ? ` · ${rivalName}` : ''}
              </span>
            </div>
            <Cards side="A" cards={crewCards(crew, own)} />
            <Cards side="B" cards={rivalCards(rivalsSeen, rivalAgents)} />
            {difficulty === 'agentic' || difficulty === 'mega' ? (
              <span className={`${c.warn} ${s.warn}`}>
                Rival crew · {rivalAgents ?? '?'} agents · {TIER_NAME[D.rivalTier]} talk
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <Button className={c.skip} size="sm" onClick={onDone} data-testid="v2-skip-intro">
        Skip intro ▸▸
      </Button>
    </div>
  );
}
