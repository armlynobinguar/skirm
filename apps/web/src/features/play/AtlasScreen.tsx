'use client';
// Map atlas (/maps): the prototype's map picker over the arena. Starter maps on the left in teal,
// veteran maps on the right in red; the chosen map's name, number and vitals in the middle over its
// own arena (the arena store switches the map). The map's number sits in a pulsing diamond, the play
// button: clicking it opens a menu beside it with Practice (at the picked difficulty), Ranked and
// Details; Escape, a click outside or a second click closes it. Under the diamond the difficulty
// picker (Easy to Mega Agentic, the prototype's DIFFS) and the goal box for that map and difficulty.
// Details opens a drawer with the goal, every difficulty's goal, items, pressure, layout, difficulty
// features and the themed verbs with their effect classes.
// Ranked goes to the Skirmish hub and always plays Normal; Practice goes to the casual crew screen
// with the picked difficulty (`?d=`).
import { RANKED_DIFFICULTY } from '@skirm/engine/v2';
import { DisplayHeading, Kicker } from '@skirm/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MiniMap } from '@/features/arena/MiniMap';
import { useArena } from '@/features/arena/store';
import { DIFFS, MAPS, VERB_ICON, diffIndex, goalOf, isStarter, type DifficultyKey, type EffectClass, type V2Map } from '@/features/arena/world';
import { routes } from '@/lib/routes';
import { useSfx } from '@/lib/sfx';
import { CommunityMaps } from '@/features/maps/CommunityMaps';
import mapStyles from '@/features/maps/maps.module.css';
import styles from './atlas.module.css';

/** Ranked always plays this difficulty (both crews chase the same goal). */
export const RANKED_DIFF: DifficultyKey = RANKED_DIFFICULTY;

/** Picker label and the small line under it; Mega Agentic is too long for a fifth of the row. */
const PICK_LABEL = ['I', 'II', 'III', 'IV', 'AGENTIC'] as const;

/** The prototype's plural: "lamps" for Lamp oil, otherwise the item with an s. */
const PLURAL: Readonly<Record<string, string>> = { 'Lamp oil': 'lamps' };
export const plural = (item: string, n: number): string => (n === 1 ? item.toLowerCase() : (PLURAL[item] ?? `${item.toLowerCase()}s`));

/** Items to deliver on a map at a difficulty: the map's count plus the difficulty's change, at least 2. */
export function goalCount(m: V2Map, d: DifficultyKey): number {
  return Math.max(2, m.A.n + (DIFFS[diffIndex(d)]?.dn ?? 0));
}

/** "4:50" for a tick (2 s ticks, counted down from 5:00). */
export function clockAt(tick: number): string {
  const s = 300 - tick * 2;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The middle-of-screen hazard line at a difficulty, e.g. "water · 41×19 · first to 4 · start the
 * pump · fog". The difficulty moves the count and can add fog.
 */
export function vitals(m: V2Map, d: DifficultyKey = RANKED_DIFF): string {
  const haz = Object.keys(m.ev);
  const sw = m.A.valves[0];
  return [
    haz.length ? haz.join(' + ') : 'No hazard',
    `${m.A.w}×${m.A.h}`,
    `first to ${goalCount(m, d)}`,
    ...(sw ? [sw.name.toLowerCase()] : []),
    ...(m.A.fog || DIFFS[diffIndex(d)]?.fog ? ['fog'] : []),
  ].join(' · ');
}

/**
 * The difficulty picker and the goal box (the prototype's diffPicker). `lock` is ranked: only Normal
 * can be picked and the box says why.
 */
export function DiffPicker({
  map: m,
  value,
  onChange,
  lock = false,
}: {
  map: V2Map;
  value: DifficultyKey;
  onChange: (d: DifficultyKey) => void;
  lock?: boolean;
}) {
  const di = diffIndex(lock ? RANKED_DIFF : value);
  const D = DIFFS[di]!;
  const g = goalOf(m, di);
  return (
    <>
      <div className={styles.dseg} role="group" aria-label="Difficulty" data-testid="atlas-diff">
        {DIFFS.map((d, i) => (
          <button
            key={d.k}
            type="button"
            style={{ '--dc': d.c } as CSSProperties}
            aria-pressed={i === di}
            aria-label={d.n}
            disabled={lock && d.k !== RANKED_DIFF}
            title={`${d.n}: ${d.line}`}
            onClick={() => onChange(d.k)}
            data-testid={`atlas-diff-${d.k}`}
          >
            {i === 4 ? 'Mega' : d.n}
            <small aria-hidden="true">{PICK_LABEL[i]}</small>
          </button>
        ))}
      </div>
      <div key={`${m.id}-${D.k}`} className={styles.goalbox} style={{ '--dc': D.c } as CSSProperties} data-testid="atlas-goal">
        <small>
          {D.n} · goal on {m.name}
        </small>
        <b>{g.t}</b>
        <span>{g.d}</span>
        <small className={styles.f}>{lock ? 'Ranked always plays Normal, so both crews chase the same goal.' : D.line}</small>
      </div>
    </>
  );
}

function Ico({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The atlas's two tabs: the official ten, and maps players made (`/maps?tab=community`). */
function AtlasTabs({ tab }: { tab: 'official' | 'community' }) {
  return (
    <nav className={mapStyles.tabs} aria-label="Atlas" data-testid="atlas-tabs">
      <Link href={routes.atlas()} aria-current={tab === 'official' ? 'page' : undefined}>
        Official
      </Link>
      <Link href={routes.atlas('community')} aria-current={tab === 'community' ? 'page' : undefined} data-testid="atlas-tab-community">
        Community
      </Link>
    </nav>
  );
}

export function AtlasScreen({ tab = 'official' }: { tab?: 'official' | 'community' }) {
  if (tab === 'community')
    return (
      <div data-testid="screen-atlas">
        <AtlasTabs tab="community" />
        <CommunityMaps />
      </div>
    );
  return <OfficialAtlas />;
}

function OfficialAtlas() {
  const { mapIdx, setMap } = useArena();
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState(false);
  const [diff, setDiff] = useState<DifficultyKey>(RANKED_DIFF);
  const sfx = useSfx();
  const play = useRef<HTMLDivElement>(null);

  // Escape and a click outside close the play menu. Escape is taken here so it does not also go Back.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setMenu(false);
    };
    const onDown = (e: PointerEvent) => {
      if (play.current && !play.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menu]);
  const m = MAPS[mapIdx] ?? MAPS[0]!;
  const pick = (i: number) => {
    sfx.play('click');
    setMap(i);
  };
  const pickDiff = (d: DifficultyKey) => {
    sfx.play('click');
    setDiff(d);
  };
  const D = DIFFS[diffIndex(diff)]!;
  const starters = MAPS.filter(isStarter);
  const veterans = MAPS.filter((x) => !isStarter(x));

  return (
    <div className={styles.screen} data-testid="screen-atlas">
      <div className={styles.shade} aria-hidden="true" />
      <h1 className="sk-sr-only">Map atlas</h1>
      <AtlasTabs tab="official" />
      <div className={styles.grid}>
        <section className={styles.side} aria-labelledby="atlas-starter" data-rise>
          <h2 id="atlas-starter" className={`${styles.sideH} ${styles.teal}`}>
            Starter maps
            <span className={styles.orn} aria-hidden="true">
              <i />
            </span>
          </h2>
          <div className={styles.cards}>
            {starters.map((x) => (
              <MapCardButton key={x.id} map={x} index={MAPS.indexOf(x)} selected={x === m} onPick={pick} />
            ))}
          </div>
        </section>

        <section className={styles.center} aria-live="polite" data-testid="atlas-center">
          <div className={styles.big}>{m.name}</div>
          <div className={styles.sub}>
            {m.label} · {m.code}
            <br />
            {m.region}
          </div>
          <svg className={styles.emblem} viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 4 34 12v16L20 36 6 28V12z" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="20" cy="20" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 9v6M20 25v6M10 15l5 3M25 22l5 3M10 25l5-3M25 18l5-3" stroke="currentColor" strokeWidth="2" />
          </svg>
          <div ref={play} className={styles.play} data-open={menu ? '' : undefined}>
            <i className={styles.pulse} aria-hidden="true" />
            <i className={styles.pulse} aria-hidden="true" />
            <button
              type="button"
              className={styles.dia}
              aria-expanded={menu}
              aria-controls="atlas-menu"
              aria-label={`Play ${m.name}`}
              onClick={() => {
                sfx.play('click');
                setMenu((o) => !o);
              }}
              data-testid="atlas-play"
            >
              <span>
                {String(mapIdx + 1).padStart(2, '0')}
                <small>Play</small>
              </span>
            </button>
            <div id="atlas-menu" className={styles.menu} aria-label={`Play ${m.name}`} role="group" data-testid="atlas-menu">
              <Link
                href={routes.crew(m.id, diff)}
                className={`${styles.mi} ${styles.miPractice}`}
                tabIndex={menu ? undefined : -1}
                data-testid="atlas-practice"
              >
                <span className={styles.miIco} aria-hidden="true">
                  <Ico d="M7 5l10 6-10 6z" />
                </span>
                <span className={styles.miLabel}>Practice · {D.n}</span>
              </Link>
              <Link
                href={routes.pvp()}
                className={`${styles.mi} ${styles.miRanked}`}
                title="Ranked always plays Normal"
                tabIndex={menu ? undefined : -1}
                data-testid="atlas-ranked"
              >
                <span className={styles.miIco} aria-hidden="true">
                  <Ico d="M5 17L17 5M13 5h4v4M5 5l4 4M13 13l4 4" />
                </span>
                <span className={styles.miLabel}>Ranked</span>
              </Link>
              <button
                type="button"
                className={styles.mi}
                tabIndex={menu ? undefined : -1}
                onClick={() => {
                  sfx.play('click');
                  setMenu(false);
                  setDetails(true);
                }}
                data-testid="atlas-details"
              >
                <span className={styles.miIco} aria-hidden="true">
                  <Ico d="M11 10v6M11 6.5v.5M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0" />
                </span>
                <span className={styles.miLabel}>Details</span>
              </button>
            </div>
          </div>
          <div className={styles.hz} data-testid="atlas-vitals">
            {vitals(m, diff)}
          </div>
          <div className={styles.dpick}>
            <DiffPicker map={m} value={diff} onChange={pickDiff} />
          </div>
        </section>

        <section className={`${styles.side} ${styles.right}`} aria-labelledby="atlas-veteran" data-rise>
          <h2 id="atlas-veteran" className={`${styles.sideH} ${styles.red}`}>
            Veteran maps
            <span className={styles.orn} aria-hidden="true">
              <i />
            </span>
          </h2>
          <div className={styles.cards}>
            {veterans.map((x) => (
              <MapCardButton key={x.id} map={x} index={MAPS.indexOf(x)} selected={x === m} onPick={pick} />
            ))}
          </div>
        </section>
      </div>

      {details ? <MapDetails map={m} diff={diff} onClose={() => setDetails(false)} /> : null}
    </div>
  );
}

function MapCardButton({
  map: m,
  index,
  selected,
  onPick,
}: {
  map: V2Map;
  index: number;
  selected: boolean;
  onPick: (i: number) => void;
}) {
  return (
    <button
      type="button"
      className={styles.card}
      aria-pressed={selected}
      aria-label={`${m.name}, ${m.label}`}
      onClick={() => onPick(index)}
      data-testid={`atlas-map-${m.id}`}
    >
      <span className={styles.bar} />
      <span className={styles.port}>
        {m.diff}
        <small>DIFF</small>
      </span>
      <span className={styles.art}>
        <MiniMap map={m} className={styles.mini} />
        <span className={styles.badge}>{String(index + 1).padStart(2, '0')}</span>
      </span>
      <span className={styles.cap}>
        <b>{m.name}</b>
        <small>
          {m.A.w}×{m.A.h}
        </small>
        <small>{m.label}</small>
      </span>
    </button>
  );
}

function MapDetails({ map: m, diff, onClose }: { map: V2Map; diff: DifficultyKey; onClose: () => void }) {
  const A = m.A;
  const sp = A.spec;
  const sw = A.valves[0];
  const haz = Object.keys(m.ev);
  const mirror = `${sp.own} each side + ${sp.cont} contested in the middle${
    sp.drops.length ? ` + ${sp.drops.length} supply drop${sp.drops.length > 1 ? 's' : ''}` : ''
  }`;
  const feats: [string, string, string][] = [];
  if (sp.fog)
    feats.push(['M2 11s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6zM11 11m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', `Fog${sp.night ? ' at night' : ''} · you see what your agents see`, 'vision']);
  if (sw)
    feats.push([
      VERB_ICON[sw.kind === 'fire' ? 'ignite' : sw.kind === 'dirt' ? 'add_solid' : 'add_liquid']!,
      `${A.valves.length} switch${A.valves.length > 1 ? 'es' : ''} · ${sw.name.toLowerCase()} ${sw.kind === 'water' ? 'floods' : sw.kind === 'fire' ? 'burns' : 'buries'} a rival tunnel`,
      'switch',
    ]);
  if (sp.drops.length)
    feats.push(['M11 3v10M7 9l4 4 4-4M4 17h14', `Supply drop${sp.drops.length > 1 ? 's' : ''} at ${sp.drops.map(clockAt).join(' and ')}`, 'timed']);
  if (sp.steal) feats.push(['M4 11h14M11 4l7 7-7 7', 'Swept agents drop what they carry. Rivals can take it', 'steal']);

  return (
    <aside className={`sk-panel is-flush ${styles.drawer}`} aria-label={`${m.name} details`} data-testid="atlas-drawer">
      <button type="button" className={styles.x} aria-label="Close details" onClick={onClose}>
        ×
      </button>
      <div className={styles.inner}>
        <span className={styles.code}>
          {m.code} · {m.region.toUpperCase()} · {m.label.toUpperCase()}
        </span>
        <DisplayHeading level={2} className={styles.drawerName}>
          {m.name}
        </DisplayHeading>
        <p className={styles.blurb}>{m.blurb}</p>
        <div className={styles.race}>
          <div className={`${styles.s} ${styles.a}`}>
            <small>You</small>
            <b>0/{A.n}</b>
          </div>
          <div className={styles.mid}>
            FIRST TO
            <br />
            DELIVER {A.n}
          </div>
          <div className={`${styles.s} ${styles.b}`}>
            <small>Rival</small>
            <b>0/{A.n}</b>
          </div>
        </div>
        <dl className={styles.kv}>
          <dt>Goal</dt>
          <dd>
            First crew to deliver {A.n} {plural(m.item, A.n)} to the {m.exitN.toLowerCase()} wins on Normal. At 5:00, more delivered wins.
          </dd>
          <dt>Goals</dt>
          <dd data-testid="atlas-goals">
            {DIFFS.map((d, i) => (
              <span key={d.k}>
                {i ? ' · ' : ''}
                <span style={{ color: d.c }}>{d.n}</span>: {goalOf(m, i).t}
              </span>
            ))}
          </dd>
          <dt>Items</dt>
          <dd>{mirror}. Fewer than both crews need.</dd>
          <dt>Pressure</dt>
          <dd>
            {m.pressure}
            {sw ? `. ${sw.name} from the middle` : ''}
            {haz.length ? `. Peaks after ${m.cap} waves, then burns out or recedes.` : '.'}
          </dd>
          <dt>Layout</dt>
          <dd>
            Mirrored · {A.w}×{A.h} tiles · one shared {m.exitN.toLowerCase()} in the middle
          </dd>
          <dt>Crew</dt>
          <dd>Multi-agentic · {m.diff >= 4 ? 'built for a full crew' : 'good for a smaller crew'}</dd>
        </dl>
        <div className={styles.proof}>
          <h3>
            Difficulty {m.diff}{' '}
            <small>
              {sp.routes} ROUTE{sp.routes > 1 ? 'S' : ''} · {sp.band * 2 + 1}-COLUMN MIDDLE
            </small>
          </h3>
          {feats.length ? (
            <div className={styles.verbs}>
              {feats.map(([d, t, c]) => (
                <div key={c} className={styles.verb}>
                  <Ico d={d} />
                  <b>{t}</b>
                  <span className={styles.vchip}>{c}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p>
            {m.id === 'copper-hollow'
              ? 'Hand-built layout.'
              : 'Generated from the base room, mirrored, with a hand-shaped middle band. Tune by hand before launch.'}
          </p>
        </div>
        <div>
          <Kicker>Themed verbs · effect class</Kicker>
          <div className={styles.verbs} style={{ marginTop: 8 } as CSSProperties} data-testid="atlas-verbs">
            {m.verbs.map(([n, c]: [string, EffectClass]) => (
              <div key={n} className={styles.verb}>
                <Ico d={VERB_ICON[c] ?? VERB_ICON.push!} />
                <b>{n}</b>
                <span className={styles.vchip}>{c}</span>
              </div>
            ))}
            <div className={styles.verb}>
              <Ico d="M3 11h16M11 3v16" />
              <b>Take · deliver · say · team</b>
              <span className={`${styles.vchip} ${styles.vchipPlain}`}>every map</span>
            </div>
          </div>
        </div>
        <span className="sk-tape" aria-hidden="true" />
        <p className="sk-kick" style={{ letterSpacing: '.12em' }}>
          Skills target effect classes, so one skill works on all 10 maps.
        </p>
      </div>
      <div className={styles.foot}>
        <Link href={routes.crew(m.id, diff)} className="sk-btn sk-btn-secondary sk-btn-lg" data-testid="atlas-drawer-practice">
          Practice here
        </Link>
        <Link href={routes.pvp()} className="sk-btn sk-btn-danger sk-btn-lg">
          Queue ranked
        </Link>
      </div>
    </aside>
  );
}
