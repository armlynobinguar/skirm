'use client';
// The map editor (/maps/editor, `?id=` opens one of the player's drafts): a grid painter for
// community maps in the skirm.map/v2 format. Left: the tile palette (floor, walls, rubble, hazard
// sources, goal items, the delivery point, spawns, switches and their lanes, supply drops), the
// mirror helper (on by default: paint one half, the other follows), size presets and undo/redo
// (Ctrl+Z / Ctrl+Y). Middle: the board; problems from validateCommunityMap are listed under it and
// marked on their tiles, live. Right: names, rules, verbs, hazards, switches and drops. Save keeps a
// draft on the server; Test play runs a few greedy-vs-greedy matches on the server and shows both
// crews' wins; Publish validates and balance-checks again and lists the map in the atlas's
// Community tab for practice and unranked play.
import {
  COMMUNITY_MAP_LIMITS,
  EFFECT_CLASSES,
  MAPS_V2,
  MAP_SIZE_PRESETS,
  blankCommunityMap,
  validateCommunityMap,
  type EffectClass,
  type MapDefV2,
  type MapIssue,
} from '@skirm/engine/v2';
import { Button } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { isApiError } from '@/lib/api/errors';
import type { CommunityMap, TestPlayResult } from '@/lib/api/communityMapTypes';
import { qk } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { BRUSHES, commit, historyOf, itemCount, mirrorHalf, paint, redo, resize, undo, type Brush, type History } from './editor';
import styles from './maps.module.css';

/** Board colours per map character (the editor's own flat look). */
/** Brushes that act once per press (they toggle a marker). */
const TOGGLES = new Set<Brush>(['start', 'switch', 'lane', 'drop', 'exit']);

const TILE_COLOUR: Record<string, string> = {
  '#': '#2b3140',
  '.': '#c9bfa8',
  ',': '#93ad5e',
  T: '#3f7a4a',
  d: '#9a6a43',
  c: '#7a5636',
  B: '#6d7480',
  '~': '#2f8fc6',
  '^': '#ff7a2a',
  L: '#d8411b',
  '*': '#ffd23f',
  E: '#34e0c8',
  V: '#b28bff',
};

export function MapEditorScreen({ id }: { id?: string }) {
  return (
    <div className={styles.page} data-testid="screen-map-editor">
      <RequireSession>
        <EditorLoader id={id} />
      </RequireSession>
    </div>
  );
}

function EditorLoader({ id }: { id?: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: qk.communityMaps.one(id ?? 'new'), queryFn: () => api.communityMap(id!), enabled: !!id, retry: false });
  if (!id) return <Editor key="new" saved={null} />;
  if (q.data === undefined) return q.isError ? <ErrorCard error={q.error} onRetry={() => void q.refetch()} /> : <Skeleton rows={8} label="Loading map" />;
  return <Editor key={q.data.id} saved={q.data} />;
}

/** What validation and publishing see: the server owns the id, code and label. */
const forCheck = (d: MapDefV2, id: string | null): MapDefV2 => ({ ...d, id: id ?? 'cmp_draft', code: 'CM-0000', label: 'Community' });

function Editor({ saved }: { saved: CommunityMap | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [h, setH] = useState<History>(() => historyOf(saved ? saved.map : blankCommunityMap(31, 13)));
  const [id, setId] = useState<string | null>(saved?.id ?? null);
  const [theme, setTheme] = useState(saved?.theme ?? 'copper-hollow');
  const [brush, setBrush] = useState<Brush>('wall');
  const [mirror, setMirror] = useState(true);
  const [switchIndex, setSwitchIndex] = useState(0);
  const [dirty, setDirty] = useState(!saved);
  const [report, setReport] = useState<TestPlayResult | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const published = saved?.status === 'published';
  const def = h.present;
  const w = def.rows[0]?.length ?? 0;
  const mid = (w - 1) / 2;

  const check = useMemo(() => validateCommunityMap(forCheck(def, id)), [def, id]);
  const issues: MapIssue[] = check.ok ? [] : check.issues;
  const marked = useMemo(() => new Set(issues.filter((i) => i.at).map((i) => `${i.at![0]},${i.at![1]}`)), [issues]);

  const change = useCallback((next: MapDefV2) => {
    setH((cur) => commit(cur, next));
    setDirty(true);
    setReport(null);
  }, []);
  const edit = (patch: Partial<MapDefV2>) => change({ ...def, ...patch });

  // Painting: press and drag over the board; one drag is one undo step.
  const dragging = useRef(false);
  /** Whether this press already made its undo step. */
  const stepped = useRef(false);
  const paintAt = (x: number, y: number, first: boolean) => {
    // Toggle brushes act once per press; tile brushes paint along the drag.
    if (published || (!first && TOGGLES.has(brush))) return;
    if (first) stepped.current = false;
    const next = paint(h.present, brush, x, y, { mirror, switchIndex });
    if (next === h.present) return;
    setH((cur) => (stepped.current ? { ...cur, present: next, future: [] } : commit(cur, next)));
    stepped.current = true;
    setDirty(true);
    setReport(null);
  };
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // Undo / redo keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) setH(undo);
      else if (k === 'y' || (k === 'z' && e.shiftKey)) setH(redo);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: def.name.trim() || 'Untitled map', theme, map: def };
      return id ? api.updateCommunityMap(id, body) : api.createCommunityMap(body);
    },
    onSuccess: (m) => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: qk.communityMaps.all });
      if (!id) {
        setId(m.id);
        router.replace(routes.mapEditor(m.id), { scroll: false });
      }
      toast.show({ tone: 'good', title: 'Draft saved' });
    },
    onError: (e) => toast.show({ tone: 'critical', title: 'Could not save', message: e instanceof Error ? e.message : undefined }),
  });

  const test = useMutation({
    mutationFn: () => api.testPlayMap(forCheck(def, id)),
    onSuccess: setReport,
    onError: (e) => toast.show({ tone: 'critical', title: 'Test play failed', message: e instanceof Error ? e.message : undefined }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty || !id) {
        const m = await save.mutateAsync();
        return api.publishCommunityMap(m.id);
      }
      return api.publishCommunityMap(id);
    },
    onSuccess: () => {
      setServerIssues([]);
      void qc.invalidateQueries({ queryKey: qk.communityMaps.all });
      toast.show({ tone: 'good', title: 'Published', message: 'Your map is in the Community tab of the atlas.' });
      router.push(routes.atlas('community'));
    },
    onError: (e) => {
      if (isApiError(e)) {
        const d = e.details ?? {};
        const list = Array.isArray(d.issues) ? (d.issues as MapIssue[]).map((i) => i.message) : Array.isArray(d.problems) ? (d.problems as string[]) : [e.message];
        setServerIssues(list);
      } else setServerIssues(['Could not publish. Try again in a moment.']);
    },
  });

  const cell = 24;
  const sw = def.switches[switchIndex];
  const lane = new Set(sw ? [...sw.lanes.A, ...sw.lanes.B] : []);
  const starts = new Map<string, string>();
  def.starts.A.forEach(([x, y], i) => starts.set(`${x},${y}`, `A${i + 1}`));
  def.starts.B.forEach(([x, y], i) => starts.set(`${x},${y}`, `B${i + 1}`));
  const drops = new Set(def.drops.map((d) => `${d.at[0]},${d.at[1]}`));
  const items = itemCount(def);

  return (
    <div className={styles.editor}>
      <aside className={`sk-panel ${styles.palette}`} aria-label="Palette">
        <span className="sk-kick">Brush</span>
        <div className={styles.brushes} role="radiogroup" aria-label="Brush">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={brush === b.id}
              title={b.hint}
              onClick={() => setBrush(b.id)}
              disabled={published}
              data-testid={`brush-${b.id}`}
            >
              <i style={{ background: b.ch ? TILE_COLOUR[b.ch] : b.id === 'start' ? 'var(--you)' : b.id === 'lane' ? 'rgba(178,139,255,.5)' : '#fff' } as CSSProperties} />
              {b.label}
            </button>
          ))}
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} data-testid="editor-mirror" /> Mirror while painting
        </label>
        <div className={styles.row}>
          <Button size="sm" disabled={published} onClick={() => change(mirrorHalf(def, 'left'))}>
            Left → right
          </Button>
          <Button size="sm" disabled={published} onClick={() => change(mirrorHalf(def, 'right'))}>
            Right → left
          </Button>
        </div>
        <div className={styles.row}>
          <Button size="sm" disabled={!h.past.length} onClick={() => setH(undo)} data-testid="editor-undo">
            Undo
          </Button>
          <Button size="sm" disabled={!h.future.length} onClick={() => setH(redo)} data-testid="editor-redo">
            Redo
          </Button>
        </div>
        <span className="sk-kick">Size (starts over)</span>
        <div className={styles.sizes}>
          {MAP_SIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={w === p.w && def.rows.length === p.h}
              disabled={published}
              onClick={() => {
                if (w === p.w && def.rows.length === p.h) return;
                if (window.confirm(`Start a new ${p.w}×${p.h} board? Undo brings this one back.`)) change(resize(def, p.w, p.h));
              }}
            >
              {p.label} <small>{p.w}×{p.h}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className={styles.boardWrap} aria-label="Board">
        <header className={styles.head}>
          <div>
            <span className="sk-kick">
              {published ? 'Published · read only' : id ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'New map · not saved'} · {items} items · goal {def.goal}
            </span>
            <h1 className="sk-disp">{def.name || 'Untitled map'}</h1>
          </div>
          <Link href={routes.atlas('community')}>Community maps</Link>
        </header>
        <div
          className={styles.board}
          style={{ gridTemplateColumns: `repeat(${w}, ${cell}px)` } as CSSProperties}
          onPointerLeave={() => (dragging.current = false)}
          data-testid="editor-board"
        >
          {def.rows.map((r, y) =>
            [...r].map((ch, x) => {
              const k = `${x},${y}`;
              const j = y * w + x;
              return (
                <div
                  key={k}
                  className={styles.cell}
                  data-mid={x === mid ? '' : undefined}
                  data-bad={marked.has(k) ? '' : undefined}
                  data-lane={lane.has(j) ? '' : undefined}
                  style={{ background: TILE_COLOUR[ch] ?? '#000' } as CSSProperties}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    dragging.current = true;
                    paintAt(x, y, true);
                  }}
                  onPointerEnter={() => dragging.current && paintAt(x, y, false)}
                  title={`${x}, ${y}`}
                  data-testid={`cell-${x}-${y}`}
                >
                  {starts.get(k) ?? (drops.has(k) ? '▼' : '')}
                </div>
              );
            }),
          )}
        </div>
        <div className={styles.issues} aria-live="polite" data-testid="editor-issues">
          {issues.length ? (
            <>
              <span className="sk-kick">
                {issues.length} problem{issues.length > 1 ? 's' : ''} before it can publish
              </span>
              <ul>
                {issues.map((i, n) => (
                  <li key={n}>
                    {i.message}
                    {i.at ? <small> ({i.at[0]}, {i.at[1]})</small> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <span className="sk-kick" data-testid="editor-valid">
              Valid map · run Test play to check the balance
            </span>
          )}
          {serverIssues.length ? (
            <div className="app-banner is-critical" role="alert" data-testid="editor-publish-error">
              <b>Not published.</b>
              <ul>
                {serverIssues.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {report ? <Report report={report} /> : null}
        <div className={styles.row}>
          <Button variant="secondary" disabled={published || save.isPending || (!dirty && !!id)} onClick={() => save.mutate()} data-testid="editor-save">
            {save.isPending ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant="secondary" disabled={!check.ok || test.isPending} onClick={() => test.mutate()} data-testid="editor-test">
            {test.isPending ? 'Playing…' : 'Test play'}
          </Button>
          <Button variant="primary" disabled={published || !check.ok || publish.isPending} onClick={() => publish.mutate()} data-testid="editor-publish">
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
          {published ? (
            <Link href={routes.practice({ mapId: saved!.id, difficulty: 'easy' })} className="sk-btn sk-btn-secondary">
              Practice on it
            </Link>
          ) : null}
        </div>
      </section>

      <aside className={`sk-panel ${styles.props}`} aria-label="Map settings">
        <fieldset disabled={published}>
          <Field label="Name" value={def.name} max={COMMUNITY_MAP_LIMITS.text.name} onChange={(v) => edit({ name: v })} testId="editor-name" />
          <Field label="Region" value={def.region} max={COMMUNITY_MAP_LIMITS.text.region} onChange={(v) => edit({ region: v })} />
          <label className={styles.field}>
            <span>Blurb</span>
            <textarea value={def.blurb} maxLength={COMMUNITY_MAP_LIMITS.text.blurb} rows={3} onChange={(e) => edit({ blurb: e.target.value })} />
          </label>
          <Field label="Goal item" value={def.item} max={COMMUNITY_MAP_LIMITS.text.item} onChange={(v) => edit({ item: v })} />
          <Field label="Delivery point" value={def.deliverTo} max={COMMUNITY_MAP_LIMITS.text.deliverTo} onChange={(v) => edit({ deliverTo: v })} />
          <label className={styles.field}>
            <span>Look</span>
            <select value={theme} onChange={(e) => (setTheme(e.target.value), setDirty(true))}>
              {MAPS_V2.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.nums}>
            <Num label="Difficulty" value={def.difficulty} min={1} max={5} onChange={(v) => edit({ difficulty: v as MapDefV2['difficulty'] })} />
            <Num label="Goal" value={def.goal} min={1} max={COMMUNITY_MAP_LIMITS.maxGoal} onChange={(v) => edit({ goal: v })} testId="editor-goal" />
            <Num label="Blocks" value={def.blockSupply} min={0} max={COMMUNITY_MAP_LIMITS.maxBlockSupply} onChange={(v) => edit({ blockSupply: v })} />
          </div>
          <div className={styles.row}>
            {(['fog', 'steal', 'night'] as const).map((k) => (
              <label key={k} className={styles.check}>
                <input type="checkbox" checked={def[k]} onChange={(e) => edit({ [k]: e.target.checked })} /> {k === 'steal' ? 'Stealing' : k === 'fog' ? 'Fog' : 'Night'}
              </label>
            ))}
          </div>

          <span className="sk-kick">Themed verbs</span>
          {def.verbs.map((v, i) => (
            <div key={i} className={styles.verb}>
              <input
                aria-label="Verb name"
                value={v.name}
                maxLength={COMMUNITY_MAP_LIMITS.text.verb}
                onChange={(e) => edit({ verbs: def.verbs.map((x, n) => (n === i ? { ...x, name: e.target.value, id: verbId(e.target.value, i) } : x)) })}
              />
              <select aria-label="Effect" value={v.effect} onChange={(e) => edit({ verbs: def.verbs.map((x, n) => (n === i ? { ...x, effect: e.target.value as EffectClass } : x)) })}>
                {EFFECT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Remove verb" onClick={() => edit({ verbs: def.verbs.filter((_, n) => n !== i) })}>
                ×
              </button>
            </div>
          ))}
          {def.verbs.length < COMMUNITY_MAP_LIMITS.maxVerbs ? (
            <Button size="sm" variant="ghost" onClick={() => edit({ verbs: [...def.verbs, { id: verbId('New verb', def.verbs.length), name: 'New verb', effect: 'push' }] })}>
              Add a verb
            </Button>
          ) : null}

          {def.hazards.length ? <span className="sk-kick">Hazards (from their source tiles)</span> : null}
          {def.hazards.map((hz, i) => (
            <div key={hz.kind} className={styles.nums}>
              <b>{hz.kind}</b>
              <Num label="Every (ticks)" value={hz.every} min={1} max={20} onChange={(v) => edit({ hazards: def.hazards.map((x, n) => (n === i ? { ...x, every: v } : x)) })} />
              <Num label="Waves" value={hz.cap} min={1} max={10} onChange={(v) => edit({ hazards: def.hazards.map((x, n) => (n === i ? { ...x, cap: v } : x)) })} />
            </div>
          ))}

          {def.switches.length ? <span className="sk-kick">Switches (paint lanes with the Switch lane brush)</span> : null}
          {def.switches.map((s, i) => (
            <div key={`${s.at[0]},${s.at[1]}`} className={styles.verb}>
              <input type="radio" name="switch" aria-label="Paint this switch's lanes" checked={switchIndex === i} onChange={() => setSwitchIndex(i)} />
              <input aria-label="Switch name" value={s.name} maxLength={COMMUNITY_MAP_LIMITS.text.switch} onChange={(e) => edit({ switches: def.switches.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)) })} />
              <select aria-label="Switch kind" value={s.kind} onChange={(e) => edit({ switches: def.switches.map((x, n) => (n === i ? { ...x, kind: e.target.value as 'water' | 'fire' | 'dirt' } : x)) })}>
                <option value="water">water</option>
                <option value="fire">fire</option>
                <option value="dirt">dirt</option>
              </select>
            </div>
          ))}

          {def.drops.length ? <span className="sk-kick">Supply drops</span> : null}
          {def.drops.map((d, i) => (
            <Num key={`${d.at[0]},${d.at[1]}`} label={`Drop at ${d.at[0]}, ${d.at[1]}: tick`} value={d.tick} min={1} max={149} onChange={(v) => edit({ drops: def.drops.map((x, n) => (n === i ? { ...x, tick: v } : x)) })} />
          ))}
        </fieldset>
      </aside>
    </div>
  );
}

/** A verb id from its name: lowercase words joined by _, unique by position. */
function verbId(name: string, i: number): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'verb';
  return `${base}_${i + 1}`;
}

function Field({ label, value, max, onChange, testId }: { label: string; value: string; max: number; onChange: (v: string) => void; testId?: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

function Num({ label, value, min, max, onChange, testId }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        data-testid={testId}
      />
    </label>
  );
}

function Report({ report }: { report: TestPlayResult }) {
  if (!report.valid)
    return (
      <div className="app-banner is-warning" role="status">
        The server found problems: {report.issues.map((i) => i.message).join('; ')}
      </div>
    );
  const b = report.balance!;
  return (
    <div className={`sk-panel ${styles.report}`} data-testid="editor-report">
      <span className="sk-kick">
        Test play · greedy vs greedy · {b.ok ? 'balanced, ready to publish' : 'not ready to publish'}
      </span>
      <p>
        The crew starting on the left won {b.wins.left}, on the right {b.wins.right}, {b.wins.draw} draw{b.wins.draw === 1 ? '' : 's'} over {b.runs.length} matches (each seed played both ways round).
      </p>
      <table>
        <thead>
          <tr>
            <th>Seed</th>
            <th>Winner</th>
            <th>Score</th>
            <th>How</th>
            <th>Ticks</th>
          </tr>
        </thead>
        <tbody>
          {b.runs.map((r) => (
            <tr key={r.seed}>
              <td>{r.seed}</td>
              <td>{r.side === 'draw' ? 'Draw' : `${r.side === 'left' ? 'Left' : 'Right'} crew`}</td>
              <td>
                {r.score.A}–{r.score.B}
              </td>
              <td>{r.reason}</td>
              <td>{r.ticks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.problems.length ? (
        <ul>
          {b.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
