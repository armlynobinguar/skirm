'use client';
// Gate for screens that need an account. Signed out: a sign-in prompt that returns here afterwards
// (S01 reads `?next=`). Loading (hydration): a skeleton, so nothing flashes.
// Public screens (the Exchange) gate single actions instead, with <SignInButton>.
// Signed out, the prompt also says what the screen is for, links the public screens, and plays the
// bot-vs-bot showreel underneath, so a first visitor sees the game before deciding to sign up.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Showreel } from '@/features/play/Showreel';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { ButtonLink } from '../ButtonLink';
import { Skeleton } from '../states/Skeleton';

/** The sign-in link that lands on `next` afterwards (default: this screen, query kept). */
export function useSignInHref(next?: string): string {
  const pathname = usePathname() ?? '/';
  // Keep the query (`?opponent=bot`, `?skill=…`) so sign-in lands on the same screen. Signed-out
  // UI only renders in the browser (the server renders the loading state), so window is there.
  const here = next ?? `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`;
  return `${routes.signIn()}?next=${encodeURIComponent(here)}`;
}

/** An action that needs an account ("Sign in to buy"), shown to signed-out visitors of a public screen. */
export function SignInButton({
  children,
  next,
  variant = 'primary',
  'data-testid': testId = 'signin-action',
}: {
  children: ReactNode;
  /** Where sign-in returns to (default: this screen). */
  next?: string;
  variant?: 'primary' | 'secondary';
  'data-testid'?: string;
}) {
  const href = useSignInHref(next);
  return (
    <ButtonLink variant={variant} href={href} data-testid={testId}>
      {children}
    </ButtonLink>
  );
}

/** What a signed-out visitor would find behind the gate, so the prompt still says what the screen is for. */
interface Pitch {
  title: string;
  lines: string[];
}

const PITCHES: { test: RegExp; pitch: Pitch }[] = [
  {
    test: /^\/(play|maps\/[^/]+\/crew)(\/|$)/,
    pitch: {
      title: 'Your command deck',
      lines: [
        'Pick a map, field your crew of AI agents and hand each one a skill.',
        'Play casual, practice against the Greedy bot, or queue for ranked.',
      ],
    },
  },
  {
    test: /^\/(pvp|lobbies|matches)(\/|$)/,
    pitch: {
      title: 'Ranked and private matches',
      lines: [
        'Queue against another crew, matched by Elo, or open a private lobby for a friend.',
        'Every ranked result is written to NEAR, where anyone can check it.',
      ],
    },
  },
  {
    test: /^\/skills(\/|$)/,
    pitch: {
      title: 'Write a skill',
      lines: [
        'A skill is a strategy in plain words. It stays sealed: only you ever see its text.',
        'Test it against the bot on the bench, then mint it on the Exchange.',
      ],
    },
  },
  {
    test: /^\/tutorial(\/|$)/,
    pitch: { title: 'Your first match', lines: ['A short briefing, then a guided match against the bot with tips as you play.'] },
  },
  {
    test: /^\/campaign(\/|$)/,
    pitch: { title: 'The campaign', lines: ['Three chapters of missions against the bot. Clearing them unlocks starter skills.'] },
  },
  {
    test: /^\/daily(\/|$)/,
    pitch: { title: 'The daily challenge', lines: ["Today's seed against the bot, the same for everyone, with a global board."] },
  },
  {
    test: /^\/puzzles(\/|$)/,
    pitch: { title: 'Puzzles', lines: ['Six small boards. Solve each in the fewest ticks for a gold medal.'] },
  },
];

function pitchFor(pathname: string): Pitch | undefined {
  return PITCHES.find((p) => p.test.test(pathname))?.pitch;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const href = useSignInHref();
  const pathname = usePathname() ?? '/';
  if (status === 'loading') return <Skeleton rows={6} />;
  if (status === 'signedOut') {
    const pitch = pitchFor(pathname);
    return (
      <div className="app-signin-gate" data-testid="signin-gate">
        <section className="app-card app-signin-needed" data-testid="signin-required">
          {pitch ? <span className="sk-kick">{pitch.title}</span> : null}
          <h1 className="app-h2">Sign in to continue</h1>
          {pitch ? (
            <ul className="app-signin-pitch" data-testid="signin-pitch">
              {pitch.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="sk-muted">This screen needs an account. No wallet needed.</p>
          <ButtonLink variant="primary" href={href}>
            Sign in
          </ButtonLink>
          <nav className="app-signin-public" aria-label="Open without signing in" data-testid="signin-public">
            <span className="sk-muted">Open without signing in:</span>
            <Link href={routes.leaderboards()}>Leaderboards</Link>
            <Link href={routes.market()}>Exchange</Link>
            <Link href={routes.atlas()}>Map atlas</Link>
            <Link href={routes.verify()}>Verify a match</Link>
          </nav>
        </section>
        <Showreel />
      </div>
    );
  }
  return <>{children}</>;
}
