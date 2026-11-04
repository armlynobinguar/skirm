'use client';
// S08 Skill editor (/skills/[skillId]/edit, and /skills/new with skillId null). Owner: skills builder.
//
// - POST /skills creates v1 (draft); PUT /skills/:id always writes the next version as a draft
//   (versions are immutable, a minted one included), so Save says which version it writes.
// - GET /skills/:id returns `prompt` and `reflexes` to the creator only: that is the read-back that
//   fills this form. Anyone else gets a "creator only" card, never text.
// - Mint: POST /skills/:id/mint needs a NEAR wallet (M01) and queues the hidden benchmark; its status
//   shows here (the mint response, then GET /market/:id for a minted version). There is no private
//   test run: the benchmark and buyers' trials are the proof.
// - A save that fails keeps the text in this browser's localStorage (UI/UX Spec States, editors),
//   keyed by account id + skill id, so another account signed in on the same browser never gets it
//   restored (the "new" key would otherwise be shared). No account id known: nothing is kept.
import { Badge, Button, Icon, TextField, UnlockChip } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { skillTriggerOf, type Tag, type Unlock } from '@skirm/shared';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { isApiError } from '@/lib/api/errors';
import { qk, useMe } from '@/lib/api/queries';
import type { MarketBenchmark, ProofJobStatus, SkillView, SkillWithText } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { ConnectWalletModal } from './ConnectWalletModal';
import {
  ACTION_UNLOCK,
  LIMITS,
  NEEDS_MODEL,
  TAGS,
  UNLOCK_ORDER,
  bpsPct,
  clockTime,
  emptyForm,
  fmtInt,
  sameForm,
  shortDate,
  toBody,
  validateForm,
  type FormErrors,
  type SkillForm,
} from './lib';
import { StatusBadge } from './parts';
import { TriggerField } from './TriggerField';
import s from './skills.module.css';

const UNLOCK_LABEL: Record<Unlock, string> = { builder: 'Builder', digger: 'Digger', firefighter: 'Firefighter' };
const UNLOCK_ICON = { builder: 'place_block', digger: 'dig', firefighter: 'extinguish' } as const;

// Spec §9 example, as placeholder text only (the S08 empty state: "a sample skill as placeholder").
const SAMPLE_PROMPT =
  'Before any task, find every tile tagged spreads+liquid that touches open floor through a gap one tile wide. Work out the step it reaches the gap from its spread interval. If you can stand next to the gap before then, go there first and place a block in it. Only then start the goal.';
const SAMPLE_REFLEXES = 'If a spreads+liquid tile is 1 tile from an open gap and place_block is legal toward the gap, place it.';

export const unsavedKey = (accountId: string, skillId: string | null) =>
  `skirm.skillEditor.unsaved.${accountId}.${skillId ?? 'new'}`;

function readUnsaved(accountId: string | null, skillId: string | null): SkillForm | null {
  if (!accountId) return null;
  try {
    const raw = window.localStorage.getItem(unsavedKey(accountId, skillId));
    return raw ? ({ ...emptyForm(), ...(JSON.parse(raw) as Partial<SkillForm>) } as SkillForm) : null;
  } catch {
    return null;
  }
}
/** false when nothing could be kept (no account id, or storage unavailable). */
function writeUnsaved(accountId: string | null, skillId: string | null, f: SkillForm | null): boolean {
  if (!accountId) return false;
  try {
    if (f) window.localStorage.setItem(unsavedKey(accountId, skillId), JSON.stringify(f));
    else window.localStorage.removeItem(unsavedKey(accountId, skillId));
    return true;
  } catch {
    return false; // storage unavailable: nothing to keep
  }
}

function formOf(sk: SkillWithText): SkillForm {
  return {
    name: sk.name,
    summary: sk.summary ?? '',
    prompt: sk.prompt,
    reflexes: sk.reflexes ?? '',
    requires: sk.requires_actions.map((a) => ACTION_UNLOCK[a as keyof typeof ACTION_UNLOCK]).filter(Boolean),
    tags: [...sk.handles_tags],
    royalty: bpsPct(sk.royalty_bps).replace('%', ''),
    trigger: skillTriggerOf(sk.trigger),
  };
}

export function SkillEditorScreen({ skillId }: { skillId: string | null }) {
  return (
    <RequireSession>
      <Loader key={skillId ?? 'new'} skillId={skillId} />
    </RequireSession>
  );
}

function Loader({ skillId }: { skillId: string | null }) {
  const api = useApi();
  const { status } = useSession();
  const me = useMe();
  const q = useQuery({
    queryKey: qk.skills.one(skillId ?? 'new'),
    queryFn: () => api.skill(skillId!),
    enabled: !!skillId && status === 'signedIn',
  });
  // The unsaved-text key needs the account id; without it (me failed) the editor keeps nothing.
  const owner = me.data?.account.id ?? null;
  if (me.isPending)
    return (
      <div className={s.page} data-testid="screen-s08">
        <Skeleton rows={8} label="Loading skill" />
      </div>
    );
  if (!skillId) return <Editor skill={null} owner={owner} />;
  if (q.data === undefined) {
    if (q.isError) {
      if (isApiError(q.error) && q.error.status === 404)
        return (
          <div className={s.page} data-testid="screen-s08">
            <EmptyState action={<ButtonLink href={routes.skills()}>Back to My skills</ButtonLink>}>
              This skill does not exist or was removed.
            </EmptyState>
          </div>
        );
      return (
        <div className={s.page} data-testid="screen-s08">
          <ErrorCard error={q.error} onRetry={() => void q.refetch()} />
        </div>
      );
    }
    return (
      <div className={s.page} data-testid="screen-s08">
        <Skeleton rows={8} label="Loading skill" />
      </div>
    );
  }
  if (!('prompt' in q.data))
    return (
      <div className={s.page} data-testid="screen-s08">
        <EmptyState action={<ButtonLink href={routes.marketSkill(skillId)}>View {q.data.name}</ButtonLink>}>
          Only the creator can edit {q.data.name}. Its text stays private to them.
        </EmptyState>
      </div>
    );
  return <Editor skill={q.data} owner={owner} />;
}

type Restored = 'restored' | 'kept' | null;

function Editor({ skill, owner }: { skill: SkillWithText | null; owner: string | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const skillId = skill?.id ?? null;

  const baseline = useMemo(() => (skill ? formOf(skill) : emptyForm()), [skill]);
  const [form, setForm] = useState<SkillForm>(baseline);
  const [tried, setTried] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [local, setLocal] = useState<Restored>(null);

  // A newer server version (after Save) resets the form unless the player kept typing.
  const [seenVersion, setSeenVersion] = useState(skill?.version ?? 0);
  if ((skill?.version ?? 0) !== seenVersion) {
    setSeenVersion(skill?.version ?? 0);
    setForm(baseline);
  }

  useEffect(() => {
    const kept = readUnsaved(owner, skillId);
    if (kept && !sameForm(kept, baseline)) {
      setForm(kept);
      setLocal('restored');
    }
    // Only on mount: later writes come from this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = !sameForm(form, baseline);
  const errors: FormErrors = validateForm(form);
  const shown: FormErrors = tried
    ? errors
    : Object.fromEntries(
        Object.entries(errors).filter(([k]) => ['summary', 'prompt', 'reflexes'].includes(k) && form[k as 'summary'].length > 0),
      );
  const nextVersion = skill ? skill.latestVersion + 1 : 1;

  const save = useMutation({
    mutationFn: (f: SkillForm): Promise<SkillView> => (skill ? api.updateSkill(skill.id, toBody(f)) : api.createSkill(toBody(f))),
    onSuccess: (view) => {
      writeUnsaved(owner, skillId, null);
      setLocal(null);
      setSavedAt(new Date());
      setTried(false);
      void qc.invalidateQueries({ queryKey: qk.skills.all });
      toast.show({ tone: 'good', title: `Saved v${view.version}`, message: `${view.name} is saved as a draft.` });
      if (!skill) router.replace(routes.editSkill(view.id));
    },
    onError: (err, f) => {
      if (writeUnsaved(owner, skillId, f)) setLocal('kept');
      toast.error(err, { title: 'Not saved' });
    },
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (Object.keys(validateForm(form)).length) return;
    save.mutate(form);
  };

  const set = <K extends keyof SkillForm>(k: K, v: SkillForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const savedLine = save.isPending
    ? 'Saving...'
    : dirty
      ? 'Unsaved changes'
      : savedAt
        ? `Saved ${clockTime(savedAt)}`
        : skill
          ? `Saved ${shortDate(skill.created_at)}`
          : 'Not saved yet';

  return (
    <form
      className={s.page}
      data-testid="screen-s08"
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          submit();
        }
      }}
    >
      <nav aria-label="Breadcrumb" className={s.crumbs}>
        <Link href={routes.skills()}>My skills</Link> / {skill?.name ?? 'New skill'}
      </nav>
      <section className={s.titleRow}>
        <div className={s.titleLeft}>
          <h1 className="app-h1" data-testid="s08-title">
            {skill?.name ?? 'New skill'}
          </h1>
          {skill ? (
            <>
              <StatusBadge status={skill.status} />
              <Badge icon={false}>
                <span data-testid="s08-version-label">v{skill.version}</span>
              </Badge>
            </>
          ) : (
            <Badge icon="info">Draft</Badge>
          )}
        </div>
        <div className={s.actions}>
          <span className={s.saved} role="status" data-testid="s08-save-state">
            {!dirty && !save.isPending ? <Icon name="check" size={14} /> : null}
            {savedLine}
          </span>
          <Button type="submit" variant="primary" loading={save.isPending} data-testid="s08-save" disabled={!dirty && !!skill}>
            {skill ? `Save as v${nextVersion}` : 'Save draft'}
          </Button>
        </div>
      </section>

      {local ? (
        <div className="app-banner is-warning" role="status" data-testid="s08-local-banner">
          <span>
            {local === 'kept'
              ? 'Not saved. Your text is kept on this device.'
              : 'Restored text that was not saved. It is kept on this device until you save.'}
          </span>
          {local === 'restored' ? (
            <Button
              size="sm"
              onClick={() => {
                writeUnsaved(owner, skillId, null);
                setForm(baseline);
                setLocal(null);
              }}
            >
              Discard it
            </Button>
          ) : null}
        </div>
      ) : null}

      {skill && skill.status !== 'Draft' ? (
        <div className="app-banner" role="note" data-testid="s08-locked">
          <Icon name="lock" size={16} />
          <span>
            v{skill.version} is minted and locked. Saving writes v{nextVersion} as a new draft; v{skill.version} and its
            token stay as they are.
          </span>
        </div>
      ) : null}

      <div className={s.columns}>
        <section aria-label="Skill text" className={`${s.panel} ${s.panelLg} ${s.main}`}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            hint="Shown everywhere the skill appears. 3 to 32 letters, digits, spaces, - and '."
            {...(shown.name ? { error: shown.name } : {})}
            maxLength={40}
            placeholder="Flood Warden"
            data-testid="s08-name"
          />
          <TextField
            label="Description"
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
            hint={`${form.summary.length} / ${LIMITS.summary} · for people only; agents never read it.`}
            {...(shown.summary ? { error: shown.summary } : {})}
            placeholder="Seals the leak before it spreads, then does the job."
            data-testid="s08-summary"
          />
          <TextBlock
            label="Prompt · read by the planner"
            value={form.prompt}
            max={LIMITS.prompt}
            rows={12}
            onChange={(v) => set('prompt', v)}
            error={shown.prompt}
            placeholder={SAMPLE_PROMPT}
            testId="s08-prompt"
          />
          <TextBlock
            label="Reflexes · optional, read by the decision model every step"
            value={form.reflexes}
            max={LIMITS.reflexes}
            rows={4}
            onChange={(v) => set('reflexes', v)}
            error={shown.reflexes}
            placeholder={SAMPLE_REFLEXES}
            testId="s08-reflexes"
          />
          <p className={s.lockNote}>
            <Icon name="lock" size={14} />
            Only you see this text, here in the editor. It is stored encrypted and runs on the server; buyers, spectators and
            replays never get it.
          </p>
        </section>

        <aside className={s.aside}>
          <section aria-labelledby="s08-needs" className={s.panel}>
            <h2 id="s08-needs" className={s.h2}>
              What it needs and handles
            </h2>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>Required unlocks</legend>
              <div className={s.checks}>
                {UNLOCK_ORDER.map((u) => {
                  const on = form.requires.includes(u);
                  return (
                    <label key={u} className={`${s.checkUnlock} ${on ? s.checkOn : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => set('requires', toggle(form.requires, u))}
                        data-testid={`s08-unlock-${u}`}
                      />
                      <Icon name={UNLOCK_ICON[u]} size={14} />
                      {UNLOCK_LABEL[u]}
                    </label>
                  );
                })}
              </div>
              <span className="app-small sk-muted">
                {form.requires.length
                  ? `Maps without ${form.requires.map((u) => UNLOCK_LABEL[u]).join(' or ')} will show this skill as not usable.`
                  : 'Needs no unlock, so it fits every map.'}
              </span>
            </fieldset>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>
                Handled tags · {form.tags.length} of {LIMITS.tagsMax}
              </legend>
              <div className={s.checks}>
                {TAGS.map((t: Tag) => {
                  const on = form.tags.includes(t);
                  return (
                    <label key={t} className={`${s.checkTag} ${on ? s.checkOn : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => set('tags', toggle(form.tags, t))} data-testid={`s08-tag-${t}`} />
                      {t}
                    </label>
                  );
                })}
              </div>
              {shown.tags ? (
                <span className={s.fieldErr} role="alert">
                  {shown.tags}
                </span>
              ) : (
                <span className="app-small sk-muted">Tags drive the market filters; agents never see them.</span>
              )}
            </fieldset>
            <TriggerField value={form.trigger} onChange={(t) => set('trigger', t)} error={shown.trigger} />
          </section>

          <MintPanel skill={skill} dirty={dirty} form={form} setRoyalty={(v) => set('royalty', v)} royaltyError={shown.royalty} />
        </aside>
      </div>
    </form>
  );
}

function TextBlock(p: {
  label: string;
  value: string;
  max: number;
  rows: number;
  onChange: (v: string) => void;
  error: string | undefined;
  placeholder: string;
  testId: string;
}) {
  const over = p.value.length > p.max;
  return (
    <div className={s.textBlock}>
      <div className={s.fieldHead}>
        <span className={s.fieldLabel} id={`${p.testId}-label`}>
          {p.label}
        </span>
        <span className={`${s.count} ${over ? s.countOver : ''}`} data-testid={`${p.testId}-count`}>
          {fmtInt(p.value.length)} / {fmtInt(p.max)}
        </span>
      </div>
      <TextField
        multiline
        mono
        {...({ rows: p.rows } as object)}
        aria-labelledby={`${p.testId}-label`}
        value={p.value}
        onChange={(e) => p.onChange((e.target as unknown as HTMLTextAreaElement).value)}
        placeholder={p.placeholder}
        {...(p.error ? { error: p.error } : {})}
        data-testid={p.testId}
      />
    </div>
  );
}

// ---------- Mint ----------

/** The benchmark's state in words, for the mint panel. */
export function benchmarkText(b: Pick<MarketBenchmark, 'status'> & Partial<Pick<MarketBenchmark, 'score'>>): string {
  switch (b.status) {
    case 'queued':
      return 'Queued: the platform plays it on hidden seeds';
    case 'running':
      return 'Running now';
    case 'needs_model':
      return NEEDS_MODEL;
    case 'failed':
      return 'Did not finish';
    case 'done':
      return b.score === null || b.score === undefined ? 'Done' : `Done · score ${Math.round(b.score * 100)}%`;
  }
}

function MintPanel({
  skill,
  dirty,
  form,
  setRoyalty,
  royaltyError,
}: {
  skill: SkillWithText | null;
  dirty: boolean;
  form: SkillForm;
  setRoyalty: (v: string) => void;
  royaltyError: string | undefined;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [wallet, setWallet] = useState(false);
  // The benchmark the mint queued (its status from the mint response).
  const [queued, setQueued] = useState<{ version: number; status: ProofJobStatus } | null>(null);

  const minted = !!skill && !skill.accountBound && skill.status !== 'Draft';
  const proof = useQuery({
    queryKey: qk.market.one(skill?.id ?? '', skill?.version),
    queryFn: () => api.marketSkill(skill!.id, skill!.version),
    enabled: minted,
    refetchInterval: (q) => (q.state.data?.benchmark && ['queued', 'running'].includes(q.state.data.benchmark.status) ? 5000 : false),
  });
  const bench = proof.data?.benchmark ?? (queued && queued.version === skill?.version ? { status: queued.status } : null);

  const mint = useMutation({
    mutationFn: () => api.mintSkill(skill!.id, skill!.version),
    onSuccess: (res) => {
      setQueued({ version: skill!.version, status: res.benchmark.status });
      void qc.invalidateQueries({ queryKey: qk.skills.all });
      void qc.invalidateQueries({ queryKey: qk.market.all });
      toast.show({
        tone: 'good',
        title: res.status === 'minted' ? `${skill!.name} is minted` : `${skill!.name} is minted. NEAR record pending`,
        message: res.tokenId ? `Token ${res.tokenId}. Your skill is an NFT on NEAR, so you can sell it.` : 'Your skill is an NFT on NEAR.',
      });
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'near_account_required') setWallet(true);
      else toast.error(err, { title: 'Not minted' });
    },
  });

  const start = () => {
    if (me.data && !me.data.account.nearAccountId) setWallet(true);
    else mint.mutate();
  };

  const draft = !skill || skill.status === 'Draft';
  const bound = !!skill?.accountBound;

  return (
    <section aria-labelledby="s08-mint" className={s.panel}>
      <h2 id="s08-mint" className={s.h2}>
        Mint and sell
      </h2>
      <TextField
        label="Creator royalty on resale"
        value={form.royalty}
        onChange={(e) => setRoyalty(e.target.value)}
        suffix="%"
        mono
        inputMode="decimal"
        hint="0 to 10%. Default 5%. Fixed for a version once it is minted."
        {...(royaltyError ? { error: royaltyError } : {})}
        data-testid="s08-royalty"
      />
      <div className={s.warnBox}>
        <span className={s.warnIcon}>
          <Icon name="warning" size={16} />
        </span>
        <span>
          Minting locks this version: prompt, reflexes, unlocks, tags, trigger and royalty. Later edits save as a new version. Needs
          a NEAR wallet. The platform then benchmarks it on hidden seeds.
        </span>
      </div>
      <dl className={s.facts}>
        <dt>Status</dt>
        <dd data-testid="s08-mint-status">{draft ? 'Not minted' : skill!.status === 'Listed' ? 'Minted and listed' : 'Minted'}</dd>
        <dt>Token id</dt>
        <dd className={s.mono}>{skill?.tokenId ?? 'Assigned at mint'}</dd>
        <dt>Benchmark</dt>
        <dd data-testid="s08-benchmark">{bench ? benchmarkText(bench) : bound ? 'None for starter skills' : minted ? 'Not queued' : 'Runs at mint'}</dd>
      </dl>
      {skill?.requires_actions.length ? (
        <div className="sk-chiprow">
          {skill.requires_actions.map((a) => (
            <UnlockChip key={a} unlock={ACTION_UNLOCK[a as keyof typeof ACTION_UNLOCK]} state="needed" />
          ))}
        </div>
      ) : null}
      {bound ? (
        <p className={s.note}>Starter skills are account-bound and never minted.</p>
      ) : draft ? (
        <Button
          icon="lock"
          block
          loading={mint.isPending}
          disabled={!skill || dirty}
          onClick={start}
          data-testid="s08-mint"
          title={!skill ? 'Save the skill first' : dirty ? 'Save first; mint uses the saved version' : undefined}
        >
          Mint skill
        </Button>
      ) : (
        <ButtonLink href={routes.marketSkill(skill!.id)} block data-testid="s08-view-market">
          View on the market
        </ButtonLink>
      )}
      <ConnectWalletModal
        open={wallet}
        reason="mint"
        onClose={() => setWallet(false)}
        onConnected={() => {
          setWallet(false);
          mint.mutate();
        }}
      />
    </section>
  );
}

