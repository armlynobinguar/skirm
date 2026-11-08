'use client';
// S01 Sign in (/). The first screen, over the arena: the pitch, a one-line explainer, sign-in with no
// wallet and a gameplay clip. Then the practice call to action and the three-part pitch (write a
// skill, the crew plays it, ranked results on NEAR) with links to /verify and the season ladder,
// both open without sign-in.
//
// "Start a practice match" signs in like the buttons do, then opens the practice crew screen vs the
// bot (routes.practice(DEFAULT_PRACTICE)) instead of `?next=` or /play: in dev mode it submits the
// typed handle (or focuses the empty field), in privy mode it focuses Continue with Google.
//
// dev mode (NEXT_PUBLIC_AUTH_MODE unset or `dev`): a handle field. The handle is sent as
//   `x-dev-user`; POST /auth/session creates the account with the starter defaults.
// privy mode: "Continue with Google" / "Continue with email" open Privy (src/lib/auth/privy.ts).
//
// States (UI/UX Spec, Sign in row): the chosen button spins and the others disable; failure shows
// "Sign-in didn't finish. Try again or use another option." with the code under Details;
// offline shows a banner and disables the buttons. Signed-in visitors go to `?next=` or /play.
//
// The handle field is uncontrolled and read from the form on submit, so text typed before hydration
// is kept (a controlled value would reset it to ''), and Sign in is never disabled for an empty
// field (an empty handle gets an inline error instead). Enter pressed before hydration submits the
// plain HTML form as `GET /?handle=…`; on hydration that handle is signed in and the query removed.
import { BOT_HANDLE, DEFAULT_PRACTICE } from '@skirm/engine/v2';
import { AgentAvatar, Badge, Button, Icon, Logo, TextField } from '@skirm/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { isApiError } from '@/lib/api/errors';
import { config } from '@/lib/config';
import { useSession } from '@/lib/auth/session';
import { DAILY_FREE_ALLOWANCE } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { ArenaCanvas } from '@/features/arena/ArenaCanvas';

/** The NEAR network the app talks to (NEXT_PUBLIC_NEAR_NETWORK), as shown in the badge. */
const NETWORK_LABEL = config.near.network === 'mainnet' ? 'Mainnet' : 'Testnet';

/** The practice pitch: what a new player can do before spending anything. */
export const PRACTICE_LINE = 'Play a practice match against a bot crew: free, no keys needed';

function useOnline(): boolean {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener('online', fn);
      window.addEventListener('offline', fn);
      return () => {
        window.removeEventListener('online', fn);
        window.removeEventListener('offline', fn);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * `?next=/maps/copper-hollow/crew` → that path; only same-origin paths are followed. Browsers read
 * `/\evil.com` like `//evil.com`, so the path is resolved and its origin compared, not just its prefix.
 */
export function nextPath(): string {
  if (typeof window === 'undefined') return routes.home();
  return safeNext(new URLSearchParams(window.location.search).get('next'), window.location.origin) ?? routes.home();
}

/** `next` as a same-origin path (with its query and hash), or null when it would leave the site. */
export function safeNext(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export function SignInScreen() {
  const session = useSession();
  const router = useRouter();
  const online = useOnline();
  const [pending, setPending] = useState<null | 'dev' | 'google' | 'email'>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  // Set by "Start a practice match": after sign-in, open the practice crew screen.
  const practiceIntent = useRef(false);
  const [practiceArmed, setPracticeArmed] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const destination = () => (practiceIntent.current ? routes.practice(DEFAULT_PRACTICE) : nextPath());

  useEffect(() => {
    if (session.status === 'signedIn' && !pending) router.replace(destination());
  }, [session.status, pending, router]);

  // A form submitted before hydration arrives as /?handle=…: sign that handle in once.
  const earlySubmit = useRef(false);
  useEffect(() => {
    if (earlySubmit.current || session.mode !== 'dev' || session.status !== 'signedOut') return;
    earlySubmit.current = true;
    const params = new URLSearchParams(window.location.search);
    const early = params.get('handle');
    if (early === null) return;
    params.delete('handle');
    const q = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    void signIn('dev', undefined, early);
  }, [session.mode, session.status]);

  async function signIn(method: 'dev' | 'google' | 'email', e?: FormEvent<HTMLFormElement>, typed?: string) {
    e?.preventDefault();
    setError(null);
    const handle = typed ?? (e ? String(new FormData(e.currentTarget).get('handle') ?? '') : '');
    if (method === 'dev' && handle.trim() === '') {
      setError({ message: 'Enter a handle to sign in.' });
      return;
    }
    setPending(method);
    try {
      await session.signIn(method === 'dev' ? { handle } : { method });
      router.replace(destination());
    } catch (err) {
      setPending(null);
      setError({
        message: isApiError(err)
          ? "Sign-in didn't finish. Try again or use another option."
          : err instanceof Error
            ? err.message
            : "Sign-in didn't finish. Try again or use another option.",
        ...(isApiError(err) ? { code: `${err.code}: ${err.message}` } : {}),
      });
    }
  }

  const disabled = !online || pending !== null;

  function startPractice() {
    practiceIntent.current = true;
    setPracticeArmed(true);
    const root = actionsRef.current;
    const form = root?.querySelector<HTMLFormElement>('form');
    const handle = form?.querySelector<HTMLInputElement>('input[name="handle"]');
    if (form && handle && handle.value.trim() !== '') form.requestSubmit();
    else (handle ?? root?.querySelector<HTMLButtonElement>('[data-testid="s01-google"]'))?.focus();
  }

  return (
    <div className="s01" data-testid="screen-s01">
      <header className="s01-header">
        <div className="app-row">
          <Logo size={28} />
          <Badge data-testid="s01-network">{NETWORK_LABEL}</Badge>
        </div>
        <Link href={routes.leaderboards()} className="app-link-strong" data-testid="s01-ladder">
          <Icon name="trophy" />
          See the season ladder, no sign-in
        </Link>
      </header>

      <ArenaCanvas scene="boot" />

      <main id="main" className="s01-main">
        {!online ? (
          <div className="app-banner is-warning" role="status" data-testid="s01-offline">
            Offline. Sign-in needs a connection.
          </div>
        ) : null}

        <section className="s01-hero" id="s01-signin-section">
          <h1 className="s01-title">Your crew plays the match. You write how.</h1>
          <p className="s01-lede">
            Write a strategy in plain words, field a multi-agentic crew of AI agents, and watch them talk their way to the goal
            before the rival crew.
          </p>

          <div className="s01-actions" ref={actionsRef}>
            {session.mode === 'dev' ? (
              <form className="s01-form" method="get" onSubmit={(e) => void signIn('dev', e)} data-testid="s01-dev-form">
                <TextField
                  label="Handle"
                  name="handle"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="tidecaller"
                  hint="Dev sign-in: pick any handle, 2 to 32 characters (a-z, 0-9, _ . -)."
                  disabled={disabled}
                  data-testid="s01-handle"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  loading={pending === 'dev'}
                  disabled={disabled}
                  data-testid="s01-signin"
                >
                  Sign in
                </Button>
              </form>
            ) : (
              <div className="s01-form">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  loading={pending === 'google'}
                  disabled={disabled}
                  onClick={() => void signIn('google')}
                  data-testid="s01-google"
                >
                  Continue with Google
                </Button>
                <Button
                  size="lg"
                  block
                  loading={pending === 'email'}
                  disabled={disabled}
                  onClick={() => void signIn('email')}
                  data-testid="s01-email"
                >
                  Continue with email
                </Button>
              </div>
            )}

            {error ? (
              <div className="app-banner is-critical" role="alert" data-testid="s01-error">
                <span>{error.message}</span>
                {error.code ? (
                  <details>
                    <summary>Details</summary>
                    <code>{error.code}</code>
                  </details>
                ) : null}
              </div>
            ) : null}

            <p className="s01-note">
              No wallet needed to play. You get <span className="sk-mono">{DAILY_FREE_ALLOWANCE}</span> free credits a
              day.
            </p>
          </div>

          <figure className="s01-media" data-testid="s01-media">
            <picture>
              <source srcSet="/media/live-overview.png" media="(prefers-reduced-motion: reduce)" />
              <img
                src="/media/gameplay.gif"
                width={800}
                height={450}
                alt="A live match: two AI crews move across the isometric map and talk in speech bubbles."
              />
            </picture>
            <figcaption className="s01-media-cap">
              <span className="s01-live-dot" aria-hidden="true" />
              A live match: two crews, one goal
            </figcaption>
          </figure>

          <div className="s01-practice app-card" data-testid="s01-practice">
            <div className="s01-practice-text">
              <span className="s01-eyebrow">Practice</span>
              <p className="s01-practice-name">{PRACTICE_LINE}.</p>
              <p className="s01-practice-meta">
                Your crew against the {BOT_HANDLE}. It starts at once, with no matchmaking, Elo or ladder at stake.
              </p>
              {practiceArmed && pending === null ? (
                <p className="s01-practice-hint" role="status" data-testid="s01-practice-hint">
                  Sign in above. Your practice match opens right after.
                </p>
              ) : null}
            </div>
            <Button icon="play" disabled={disabled} onClick={startPractice} data-testid="s01-practice-start">
              Start a practice match
            </Button>
          </div>
        </section>

        <section aria-label="How it works" className="s01-steps" data-testid="s01-steps">
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">1</span>
              <h2 className="app-h3">Write a skill</h2>
            </div>
            <p className="sk-muted">
              A strategy in plain words. Mint it as an NFT on NEAR and sell it on the market: resales pay you a
              royalty, and buyers run it without ever seeing your text.
            </p>
          </article>
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">2</span>
              <h2 className="app-h3">Your crew plays it</h2>
            </div>
            <p className="sk-muted">
              Multi-agentic crews: each agent has a role, sight and voice range. Two-second ticks, five minutes at most; rivals
              near a speaker overhear it.
            </p>
            <div className="app-row">
              <AgentAvatar size={32} label="Rook" role="Scout" body="#8fa8ff" crew="a" />
              <span className="sk-mono sk-muted">Rook · Builder · Standard</span>
            </div>
          </article>
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">3</span>
              <h2 className="app-h3">Results on NEAR</h2>
            </div>
            <p className="sk-muted">
              Every ranked result is recorded on NEAR {NETWORK_LABEL.toLowerCase()} with its Elo change, and anyone
              can check a match against the chain. The 14-day season&apos;s top 10 split the prize pool.
            </p>
            <div className="s01-step-links">
              <Link href={routes.verify()} className="app-link-strong" data-testid="s01-verify">
                Verify a match
              </Link>
              <Link href={routes.leaderboards()} className="app-link-strong" data-testid="s01-steps-ladder">
                Season ladder
              </Link>
            </div>
          </article>
        </section>
        <p className="sk-muted s01-legal" data-testid="s01-legal">
          {NETWORK_LABEL}. By playing you accept the <Link href={routes.terms()}>terms</Link>; how your data is used is in the{' '}
          <Link href={routes.privacy()}>privacy policy</Link>.
        </p>
      </main>
    </div>
  );
}
