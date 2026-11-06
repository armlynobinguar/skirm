'use client';
// "Back this writer" on a skill's page: the open backing rounds of the skill's writer that cover
// this skill (GET /backing/rounds?skill=), each with the back form. Renders nothing when the writer
// has no open round or backing is off. Signed out (the public Exchange): the rounds, and "Sign in to
// back" in place of the form.
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { SignInButton } from '@/components/shell/RequireSession';
import { qk } from '@/lib/api/queries';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { BackForm, RoundSummary } from './BackRound';
import b from './backing.module.css';

export function BackWriterPanel({ skillId, isCreator }: { skillId: string; isCreator: boolean }) {
  const api = useApi();
  const signedOut = useSession().status === 'signedOut';
  const config = useQuery({ queryKey: qk.backing.config, queryFn: () => api.backingConfig(), retry: false });
  const q = { skill: skillId, status: 'open' as const };
  const rounds = useQuery({ queryKey: qk.backing.rounds(q), queryFn: () => api.backingRounds(q), retry: false });
  const mode = config.data?.mode ?? 'off';
  const list = rounds.data?.rounds ?? [];
  if (mode === 'off' || !list.length) return null;
  const cpn = config.data?.creditsPerNear;
  return (
    <section className={b.panel} aria-label="Back this writer" data-testid="s10-backing">
      <span className="sk-kick">Back this writer</span>
      {list.map((r) => (
        <div key={r.id} className={b.item}>
          <RoundSummary r={r} {...(cpn ? { creditsPerNear: cpn } : {})} />
          {isCreator ? null : signedOut ? (
            <SignInButton variant="secondary" next={routes.marketSkill(skillId)} data-testid="backing-signin">
              Sign in to back
            </SignInButton>
          ) : (
            <BackForm r={r} mode={mode} {...(cpn ? { creditsPerNear: cpn } : {})} />
          )}
        </div>
      ))}
      <Link href={routes.backing()} className={b.muted}>
        All rounds and your backings
      </Link>
    </section>
  );
}
