'use client';
// Starter templates on My skills: a handful of example strategies (GET /onboarding/templates), full
// text shown, each copied into a new draft of the player's own in one click
// (POST /onboarding/templates/:id/copy), which then opens in the editor. Hidden when the api has none.
import { UNLOCK_ACTION, type Unlock } from '@skirm/shared';
import { Button, TagChip, UnlockChip } from '@skirm/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { SkillTemplateView } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useCopyTemplate, useSkillTemplates } from './hooks';
import o from './onboarding.module.css';

const UNLOCK_OF = Object.fromEntries(Object.entries(UNLOCK_ACTION).map(([u, a]) => [a, u as Unlock])) as Record<string, Unlock>;

export function SkillTemplates() {
  const q = useSkillTemplates();
  if (!q.data?.length) return null;
  return (
    <section className={o.templates} aria-labelledby="skill-templates-title" data-testid="skill-templates">
      <div>
        <h2 id="skill-templates-title" className="app-h2">
          Starter templates
        </h2>
        <p className="sk-muted">Example strategies to learn from. Copy one into a draft of your own, then change it to fit your crew.</p>
      </div>
      <div className={o.tplGrid}>
        {q.data.map((t) => (
          <Template key={t.id} t={t} />
        ))}
      </div>
    </section>
  );
}

function Template({ t }: { t: SkillTemplateView }) {
  const copy = useCopyTemplate();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const onCopy = () =>
    copy.mutate(t.id, {
      onSuccess: (skill) => {
        toast.show({ tone: 'good', title: `${t.name} copied`, message: 'It is a draft of yours now: edit it, test it, mint it.' });
        router.push(routes.editSkill(skill.id));
      },
      onError: (e) => toast.error(e),
    });
  return (
    <article className={o.tpl} data-testid={`template-${t.id}`}>
      <h3 className={o.tplName}>{t.name}</h3>
      <span className={o.tplMeta}>{t.bestFor}</span>
      <p className={o.tplSummary}>{t.summary}</p>
      <p className={o.tplMeta}>{t.lesson}</p>
      <div className={o.chips}>
        {t.handles_tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {t.requires_actions.map((a) =>
          UNLOCK_OF[a] ? <UnlockChip key={a} unlock={UNLOCK_OF[a]} state="needed" /> : null,
        )}
      </div>
      {open ? (
        <div data-testid={`template-text-${t.id}`}>
          <p className={o.tplText}>{t.prompt}</p>
          <p className={o.tplMeta}>Reflexes</p>
          <p className={o.tplText}>{t.reflexes}</p>
        </div>
      ) : null}
      <div className={o.tplFoot}>
        <Button variant="primary" size="sm" onClick={onCopy} loading={copy.isPending} disabled={copy.isPending} data-testid={`template-copy-${t.id}`}>
          Copy to my drafts
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} data-testid={`template-read-${t.id}`}>
          {open ? 'Hide text' : 'Read it'}
        </Button>
      </div>
    </article>
  );
}
