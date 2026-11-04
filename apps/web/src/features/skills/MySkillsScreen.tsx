'use client';
// S07 My skills (/skills, ?tab=owned). Owner: skills builder. Design: .design-src/screens/S07-My-skills.dc.html
// Tabs "Written by me" (GET /skills?tab=written: latest version of each skill I wrote) and "Owned"
// (?tab=owned: versions I hold). Rows carry public fields + status only.
import { Icon, Tabs, TagChip, UnlockChip } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { SkillTemplates } from '@/features/onboarding/SkillTemplates';
import { EmptyState } from '@/components/states/EmptyState';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { qk } from '@/lib/api/queries';
import type { SkillRow } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { bpsPct, near, shortDate } from './lib';
import { StatusBadge } from './parts';
import s from './skills.module.css';

type Tab = 'written' | 'owned';

export function MySkillsScreen() {
  return (
    <RequireSession>
      <Suspense fallback={<Skeleton rows={6} />}>
        <MySkills />
      </Suspense>
    </RequireSession>
  );
}

function MySkills() {
  const api = useApi();
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'owned' ? 'owned' : 'written');
  const enabled = status === 'signedIn';
  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written'), enabled });
  const owned = useQuery({ queryKey: qk.skills.list('owned'), queryFn: () => api.skills('owned'), enabled });
  const q = tab === 'written' ? written : owned;

  const select = (id: string) => {
    const t: Tab = id === 'owned' ? 'owned' : 'written';
    setTab(t);
    router.replace(routes.skills(t), { scroll: false });
  };

  return (
    <div className={s.page} data-testid="screen-s07">
      <section className={s.head}>
        <div className={s.headText}>
          <h1 className="app-h1">My skills</h1>
          <p className={s.lede}>Skills you wrote and skills you own. Your skill text stays private, even after you sell copies.</p>
        </div>
        <ButtonLink href={routes.newSkill()} variant="primary" icon="plus" data-testid="s07-new-skill">
          New skill
        </ButtonLink>
      </section>

      <Tabs
        label="Skill lists"
        value={tab}
        onChange={select}
        tabs={[
          { id: 'written', label: 'Written by me', ...(written.data ? { count: written.data.length } : {}) },
          { id: 'owned', label: 'Owned', ...(owned.data ? { count: owned.data.length } : {}) },
        ]}
      />

      <div role="tabpanel" data-testid={`s07-panel-${tab}`}>
        <QueryView
          query={q}
          loading={<Skeleton rows={6} label="Loading skills" />}
          empty={(rows) =>
            rows.length === 0 &&
            (tab === 'written' ? (
              <EmptyState action={<ButtonLink href={routes.newSkill()} variant="primary" icon="plus">Write a skill</ButtonLink>}>
                You have not written a skill yet. Write one, test it privately, then mint it.
              </EmptyState>
            ) : (
              <EmptyState action={<ButtonLink href={routes.market()}>Browse the market</ButtonLink>}>
                You own no skills yet. Find one by proof in the market.
              </EmptyState>
            ))
          }
        >
          {(rows) => <SkillTable rows={rows} tab={tab} />}
        </QueryView>
      </div>

      {tab === 'written' ? <SkillTemplates /> : null}

      <p className={s.note}>
        Royalties are paid to your NEAR wallet on each resale.
      </p>
    </div>
  );
}

function SkillTable({ rows, tab }: { rows: SkillRow[]; tab: Tab }) {
  return (
    <div className={s.tableCard}>
      <table className={`${s.table} ${s.wide}`}>
        <thead>
          <tr>
            <th scope="col">Skill</th>
            <th scope="col">Status</th>
            <th scope="col">Handles</th>
            <th scope="col">Needs</th>
            <th scope="col" className={s.right}>
              Royalties
            </th>
            <th scope="col">
              <span className={s.srOnly}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <SkillRowView key={`${r.id}:${r.version}`} row={r} tab={tab} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function subLine(r: SkillRow, tab: Tab): string {
  const parts = [`v${r.version}`];
  if (r.accountBound) parts.push('Starter skill, account-bound');
  else if (r.status === 'Draft') parts.push(`Saved ${shortDate(r.created_at)}`);
  else parts.push(`Minted · ${bpsPct(r.royalty_bps)} royalty`);
  if (tab === 'owned' && r.creator) parts.push(`by ${r.creatorAccount.handle}`);
  return parts.join(' · ');
}

function SkillRowView({ row: r, tab }: { row: SkillRow; tab: Tab }) {
  const canEdit = tab === 'written' && !r.accountBound;
  const isPublic = r.status !== 'Draft' || tab === 'owned';
  return (
    <tr data-testid={`s07-skill-row-${r.id}`}>
      <td>
        <div className={s.skillName}>
          <Icon name="skill" />
          <span data-testid="s07-skill-name">{r.name}</span>
        </div>
        <div className={s.skillSub}>{subLine(r, tab)}</div>
      </td>
      <td data-testid="s07-status">
        <StatusBadge status={r.status} />
      </td>
      <td>
        <div className={s.chips}>
          {r.handles_tags.map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </div>
      </td>
      <td>
        {r.requiredUnlocks.length ? (
          <div className={s.chips}>
            {r.requiredUnlocks.map((u) => (
              <UnlockChip key={u} unlock={u} state="needed" />
            ))}
          </div>
        ) : (
          <span className="sk-muted">None</span>
        )}
      </td>
      {tab === 'written' && r.royaltiesYocto !== undefined ? (
        <td className={`${s.right} ${s.mono}`} data-testid="s07-royalties">
          {near(r.royaltiesYocto)}
        </td>
      ) : (
        <td
          className={`${s.right} ${s.mono} sk-muted`}
          title={tab === 'owned' ? 'Royalties go to the creator' : undefined}
          data-testid="s07-royalties"
        >
          –
        </td>
      )}
      <td>
        {canEdit ? (
          <Link className={s.rowLink} href={routes.editSkill(r.id)} data-testid={`s07-edit-${r.id}`}>
            {r.status === 'Draft' ? 'Edit' : 'New version'}
          </Link>
        ) : null}
        {tab === 'owned' || r.status === 'Draft' ? (
          <Link className={s.rowLink} href={routes.skillBench(r.id, r.version)} data-testid={`s07-bench-${r.id}`}>
            Test
          </Link>
        ) : null}
        {isPublic ? (
          <Link className={s.rowLink} href={routes.marketSkill(r.id)} data-testid={`s07-view-${r.id}`}>
            View
          </Link>
        ) : null}
      </td>
    </tr>
  );
}
