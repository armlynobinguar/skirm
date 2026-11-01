'use client';
// The map entrance before a live match (the prototype's runIntro): the map's name, the objective
// and goal, the hazard warning (a flash and a shake as the hazards rise in), then both crews. The
// camera starts pulled far out and drifts in. Skip with the button, Enter, Space or Esc. The match
// itself is server-paced and already running underneath; the HUD fades in when the intro ends.
import { DIFF_MODS, mapV2, type Difficulty } from '@skirm/engine/v2';
import { Button, HazardTape } from '@skirm/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { setLiveFx } from '@/features/arena/live';
import { mapById } from '@/features/arena/world';
import c from './hud.module.css';
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

/** When each card comes up (ms from the start), and when the intro hands over. */
export const INTRO_MS = { title: 250, goal: 2500, hazard: 5300, crews: 7300, done: 9300 } as const;

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
  onDone: () => void;
}

export function Intro({ mapId, ranked, difficulty, goal, limit, tickMs, you, rivalHandle, crew, rivalAgents, onDone }: IntroProps) {
  const [step, setStep] = useState<'' | keyof typeof INTRO_MS>('');
  const [flash, setFlash] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    setLiveFx({ intro: true, revealAt: null, deployAt: null, shakeAt: null });
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
    return () => ts.forEach(clearTimeout);
  }, []);

  const def = mapV2(mapId);
  const look = mapById(mapId);
  const tag = goalTag(mapId, difficulty);
  const D = DIFF_MODS[difficulty];
  const item = def?.item ?? 'Item';
  const hz = def?.hazards[0]?.kind;
  return (
    <div className={c.intro} data-testid="v2-intro">
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
          <div key="crews" className={`${c.ic} ${c.crews}`}>
            <div className={`${c.side} ${c.sideA}`}>
              <span className="sk-kick">
                <b>You</b>
                {you ? ` · ${you}` : ''}
              </span>
              <span className={c.crewName}>{crew.join(' · ') || 'Your crew'}</span>
            </div>
            <span className={c.vsx}>VS</span>
            <div className={`${c.side} ${c.sideB}`}>
              <span className="sk-kick">
                <span className={c.r}>Rival</span>
                {rivalHandle ? ` · ${rivalHandle}` : ''}
              </span>
              <span className={c.crewName}>{rivalAgents ? `${rivalAgents} unseen` : 'Unseen'}</span>
            </div>
            {difficulty === 'agentic' || difficulty === 'mega' ? (
              <span className={c.warn}>
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
