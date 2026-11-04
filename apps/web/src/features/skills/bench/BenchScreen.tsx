'use client';
// Skill test bench (/skills/bench?skill=&version=&map=&d=). A writer picks a skill version (a draft
// they wrote or a minted version they hold), a map and a difficulty, edits the prompt if it is
// theirs, and runs it headless against the greedy bot. Runs are listed newest first with their
// result; "Re-run" plays the same seed with the prompt in the editor, and ticking two runs shows
// them side by side with a word diff of the prompts that played.
import { Button, Icon } from '@skirm/ui';
import { DIFFICULTIES, DIFF_MODS, MAPS_V2, type Difficulty } from '@skirm/engine/v2';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { ButtonLink } from '@/components/ButtonLink';
import { qk } from '@/lib/api/queries';
import type { BenchInfo, BenchRun, SkillRow } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '../skills.module.css';
import b from './bench.module.css';
import { useBenchCompare, useBenchInfo, useBenchRuns, useStartBenchRun } from './hooks';
import { Debrief, EventList, PromptDiff, RunStatus, scoreLine, seedLabel } from './parts';

export const PROMPT_MAX = 1200;
export const REFLEXES_MAX = 400;

/** A version the caller may bench, and whether its text is theirs to edit. */
export interface BenchOption {
  skillId: string;
  version: number;
  name: string;
  mine: boolean;
  label: string;
}

/** Drafts the caller wrote, then every version they hold (one entry per skill version). */
export function benchOptions(written: SkillRow[], owned: SkillRow[]): BenchOption[] {
  const out = new Map<string, BenchOption>();
  for (const r of written)
    if (r.status === 'Draft')
      out.set(`${r.id}:${r.version}`, { skillId: r.id, version: r.version, name: r.name, mine: true, label: `${r.name} v${r.version} · Draft` });
  const writtenIds = new Set(written.map((r) => r.id));
  for (const r of owned) {
    const key = `${r.id}:${r.version}`;
    if (out.has(key)) continue;
    const mine = writtenIds.has(r.id) && !r.accountBound;
    out.set(key, { skillId: r.id, version: r.version, name: r.name, mine, label: `${r.name} v${r.version} · ${r.accountBound ? 'Starter' : 'Minted'}` });
  }
  return [...out.values()];
}

export function BenchScreen() {
  return (
    <RequireSession>
      <Suspense fallback={<Skeleton rows={6} />}>
        <Bench />
      </Suspense>
    </RequireSession>
  );
}

function Bench() {
  const api = useApi();
  const params = useSearchParams();
  const { status } = useSession();
  const enabled = status === 'signedIn';
  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written'), enabled });
  const owned = useQuery({ queryKey: qk.skills.list('owned'), queryFn: () => api.skills('owned'), enabled });
  const info = useBenchInfo();

  const options = useMemo(
    () => (written.data && owned.data ? benchOptions(written.data, owned.data) : undefined),
    [written.data, owned.data],
  );

  return (
    <div className={s.page} data-testid="screen-bench">
      <section className={s.head}>
        <div className={s.headText}>
          <div className={s.crumbs}>
            <Link href={routes.skills()}>My skills</Link> / Test bench
          </div>
          <h1 className="app-h1">Test bench</h1>
          <p className={s.lede}>
            Play a skill against the greedy bot on any map and difficulty, change the prompt, run the same seed again
            and compare the two runs.
          </p>
        </div>
      </section>
      {info.data ? <CostNote info={info.data} /> : null}
      {written.isError || owned.isError ? (
        <ErrorCard error={written.error ?? owned.error} onRetry={() => void (written.refetch(), owned.refetch())} />
      ) : !options ? (
        <Skeleton rows={6} label="Loading skills" />
      ) : options.length === 0 ? (
        <EmptyState action={<ButtonLink href={routes.newSkill()} variant="primary" icon="plus">Write a skill</ButtonLink>}>
          Nothing to test yet. Write a draft, or buy a skill, then bring it here.
        </EmptyState>
      ) : (
        <BenchBody
          options={options}
          info={info.data}
          initial={{
            skill: params.get('skill'),
            version: Number(params.get('version')) || null,
            map: params.get('map'),
            difficulty: params.get('d'),
          }}
        />
      )}
    </div>
  );
}

function CostNote({ info }: { info: BenchInfo }) {
  return (
    <div className={`app-banner${info.free ? '' : ' is-warning'}`} role="note" data-testid="bench-cost">
      <Icon name="info" size={16} />
      <span>
        {info.free
          ? 'Free here: the offline greedy brain plays your agent too, so it shows how the map plays, not what your prompt changes.'
          : `Each run plays your agent with the model and holds ${info.costCredits} credits (free allowance first); what it does not use comes back.`}{' '}
        {info.limit.left} of {info.limit.perHour} runs left this hour.
      </span>
    </div>
  );
}

function BenchBody({
  options,
  info,
  initial,
}: {
  options: BenchOption[];
  info: BenchInfo | undefined;
  initial: { skill: string | null; version: number | null; map: string | null; difficulty: string | null };
}) {
  const api = useApi();
  const toast = useToast();
  const first =
    options.find((o) => o.skillId === initial.skill && (initial.version === null || o.version === initial.version)) ??
    options[0]!;
  const [key, setKey] = useState(`${first.skillId}:${first.version}`);
  const opt = options.find((o) => `${o.skillId}:${o.version}` === key) ?? first;
  const [mapId, setMapId] = useState(MAPS_V2.some((m) => m.id === initial.map) ? initial.map! : MAPS_V2[0]!.id);
  const [difficulty, setDifficulty] = useState<Difficulty>(
    DIFFICULTIES.includes(initial.difficulty as Difficulty) ? (initial.difficulty as Difficulty) : 'easy',
  );

  // The writer's own text, to edit for the next run.
  const text = useQuery({
    queryKey: qk.skills.one(opt.skillId, opt.version),
    queryFn: () => api.skill(opt.skillId, opt.version),
    enabled: opt.mine,
  });
  const original = text.data && 'prompt' in text.data ? { prompt: text.data.prompt, reflexes: text.data.reflexes ?? '' } : null;
  const [prompt, setPrompt] = useState('');
  const [reflexes, setReflexes] = useState('');
  useEffect(() => {
    if (original) {
      setPrompt(original.prompt);
      setReflexes(original.reflexes);
    }
    // Reset the editor when another version's text loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original?.prompt, original?.reflexes, key]);
  const edited = !!original && (prompt !== original.prompt || reflexes !== original.reflexes);
  const tooLong = prompt.length > PROMPT_MAX || reflexes.length > REFLEXES_MAX;

  const runs = useBenchRuns(opt.skillId);
  const start = useStartBenchRun();
  const [picked, setPicked] = useState<string[]>([]);
  const outOfRuns = info ? info.limit.left <= 0 : false;

  const run = (seed: { mapId: string; difficulty: Difficulty }) =>
    start.mutate(
      {
        skillId: opt.skillId,
        version: opt.version,
        ...seed,
        ...(edited ? { prompt, reflexes: reflexes || null } : {}),
      },
      {
        onSuccess: () => toast.show({ tone: 'good', title: 'Run queued', message: `${seedLabel(seed)} against the greedy bot` }),
        onError: (err) => toast.error(err),
      },
    );

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  return (
    <>
      <section className={s.panel} aria-label="Run setup">
        <div className={b.controls}>
          <label className={s.selectLabel}>
            Skill
            <select className={s.select} value={key} onChange={(e) => (setKey(e.target.value), setPicked([]))} data-testid="bench-skill">
              {options.map((o) => (
                <option key={`${o.skillId}:${o.version}`} value={`${o.skillId}:${o.version}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={s.selectLabel}>
            Map
            <select className={s.select} value={mapId} onChange={(e) => setMapId(e.target.value)} data-testid="bench-map">
              {MAPS_V2.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className={s.selectLabel}>
            Difficulty
            <select
              className={s.select}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              data-testid="bench-difficulty"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFF_MODS[d].name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {opt.mine ? (
          text.isError ? (
            <ErrorCard error={text.error} onRetry={() => void text.refetch()} />
          ) : !original ? (
            <Skeleton rows={3} label="Loading the prompt" />
          ) : (
            <>
              <label className={s.selectLabel}>
                <span className={s.fieldHead}>
                  <span>Prompt for the next run{edited ? ' · edited' : ''}</span>
                  <span className={`${s.count} ${prompt.length > PROMPT_MAX ? s.countOver : ''}`}>
                    {prompt.length} / {PROMPT_MAX}
                  </span>
                </span>
                <textarea
                  className={`${s.select} ${b.diff}`}
                  rows={8}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  data-testid="bench-prompt"
                />
              </label>
              <label className={s.selectLabel}>
                <span className={s.fieldHead}>
                  <span>Reflexes</span>
                  <span className={`${s.count} ${reflexes.length > REFLEXES_MAX ? s.countOver : ''}`}>
                    {reflexes.length} / {REFLEXES_MAX}
                  </span>
                </span>
                <textarea
                  className={`${s.select} ${b.diff}`}
                  rows={3}
                  value={reflexes}
                  onChange={(e) => setReflexes(e.target.value)}
                  data-testid="bench-reflexes"
                />
              </label>
              <p className={s.note}>
                Edits here play only on the bench and are not saved to the skill.{' '}
                <Link href={routes.editSkill(opt.skillId)}>Open the editor</Link> to save a version.
              </p>
            </>
          )
        ) : (
          <p className={s.lockNote}>
            <Icon name="lock" size={16} /> You hold this version but did not write it: it plays with its own hidden prompt.
          </p>
        )}

        <div className={b.actions}>
          <Button
            variant="primary"
            icon="play"
            loading={start.isPending}
            disabled={start.isPending || tooLong || outOfRuns || (edited && !prompt.trim())}
            onClick={() => run({ mapId, difficulty })}
            data-testid="bench-run"
          >
            Run against the greedy bot
          </Button>
          {edited ? (
            <Button variant="ghost" onClick={() => original && (setPrompt(original.prompt), setReflexes(original.reflexes))}>
              Reset prompt
            </Button>
          ) : null}
        </div>
      </section>

      <section className={s.panel} aria-label="Runs">
        <h2 className={s.h2}>Runs of {opt.name}</h2>
        <QueryView
          query={runs}
          loading={<Skeleton rows={3} label="Loading runs" />}
          empty={(rows) => rows.length === 0 && <p className="sk-muted">No runs yet. Pick a seed and run it.</p>}
        >
          {(rows) => (
            <ul className={b.runs} data-testid="bench-runs">
              {rows.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  picked={picked.includes(r.id)}
                  onPick={() => toggle(r.id)}
                  onRerun={() => run({ mapId: r.mapId, difficulty: r.difficulty })}
                  rerunDisabled={start.isPending || tooLong || outOfRuns}
                />
              ))}
            </ul>
          )}
        </QueryView>
        {picked.length === 1 ? <p className={s.note}>Tick one more run to compare.</p> : null}
      </section>

      {picked.length === 2 ? <Compare a={picked[0]!} b={picked[1]!} /> : null}
    </>
  );
}

function RunRow(p: { run: BenchRun; picked: boolean; onPick: () => void; onRerun: () => void; rerunDisabled: boolean }) {
  const r = p.run;
  return (
    <li className={b.run} data-testid={`bench-run-${r.id}`}>
      <div className={b.runMeta}>
        <span>
          <RunStatus run={r} /> {seedLabel(r)}
        </span>
        <span className={b.runSub}>
          v{r.version}
          {r.edited ? ' · edited prompt' : ''}
          {r.result ? ` · ${scoreLine(r.result)}` : ''}
          {r.status === 'insufficient_credits' && r.shortfall ? ` · needs ${r.shortfall.need} credits` : ''}
          {r.credits ? ` · ${r.credits} credits` : ''}
        </span>
      </div>
      <div className={b.actions}>
        <label className={b.pick}>
          <input type="checkbox" checked={p.picked} onChange={p.onPick} data-testid={`bench-pick-${r.id}`} />
          Compare
        </label>
        <Button size="sm" variant="ghost" onClick={p.onRerun} disabled={p.rerunDisabled} data-testid={`bench-rerun-${r.id}`}>
          Re-run this seed
        </Button>
        {r.status === 'done' ? (
          <Link className={b.link} href={routes.benchRun(r.id)} data-testid={`bench-debrief-${r.id}`}>
            Debrief
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Compare({ a, b: bId }: { a: string; b: string }) {
  const q = useBenchCompare(a, bId);
  return (
    <section className={s.panel} aria-label="Comparison" data-testid="bench-compare">
      <h2 className={s.h2}>Side by side</h2>
      <QueryView query={q} loading={<Skeleton rows={6} label="Loading the comparison" />}>
        {(c) => (
          <>
            <div className={b.side}>
              {[c.a, c.b].map((r, i) => (
                <div className={b.col} key={r.id} data-testid={`bench-compare-${i === 0 ? 'a' : 'b'}`}>
                  <h3 className="app-h3">
                    {i === 0 ? 'A' : 'B'} · <RunStatus run={r} />
                  </h3>
                  <span className={b.runSub}>
                    {seedLabel(r)} · v{r.version}
                    {r.edited ? ' · edited prompt' : ''}
                  </span>
                  {r.result ? (
                    <>
                      <Debrief result={r.result} />
                      <EventList result={r.result} />
                    </>
                  ) : (
                    <p className="sk-muted">No result yet.</p>
                  )}
                </div>
              ))}
            </div>
            <h3 className="app-h3">Prompt, A to B</h3>
            {c.prompt.hidden ? (
              <p className="sk-muted">Hidden: one of these runs played a prompt you did not write.</p>
            ) : c.prompt.same ? (
              <p className="sk-muted" data-testid="bench-diff-same">
                Both runs played the same prompt.
              </p>
            ) : (
              <PromptDiff parts={c.prompt.diff} />
            )}
          </>
        )}
      </QueryView>
    </section>
  );
}
