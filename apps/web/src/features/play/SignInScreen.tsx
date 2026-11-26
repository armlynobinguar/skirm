'use client';
// S01 Sign in (/). The first screen, over the arena: the pitch, a one-line explainer, one main call
// to action (a free practice match) with sign-in under it, a gameplay clip and the season's pulse.
// Below: the showreel (real bot-vs-bot matches played in the browser, no sign-in), the Zama strip
// when NEXT_PUBLIC_ZAMA_ENABLED is on, and the three-part pitch (write a skill, the crew plays it,
// ranked results on NEAR) with links to /verify and the season ladder, both open without sign-in.
//
// "Play a free match" signs in, then opens the practice crew screen vs the bot
// (routes.practice(DEFAULT_PRACTICE)) instead of `?next=` or /play: in privy mode it opens Google
// sign-in at once, in dev mode it submits the typed handle (or focuses the empty field).
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
import { useCurrentSeason, useSeasonStandings, useV2LiveMatches } from '@/lib/api/queries';
import { config } from '@/lib/config';
import { useSession } from '@/lib/auth/session';
import { DAILY_FREE_ALLOWANCE } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { zamaConfig } from '@/lib/zama/config';
import { ArenaCanvas } from '@/features/arena/ArenaCanvas';
import { Showreel } from './Showreel';

/** The NEAR network the app talks to (NEXT_PUBLIC_NEAR_NETWORK), as shown in the badge. */
const NETWORK_LABEL = config.near.network === 'mainnet' ? 'Mainnet' : 'Testnet';

/** The practice pitch: what a new player can do before spending anything. */
export const PRACTICE_LINE = 'Play a practice match against a bot crew: free, no keys needed';

/** "3 d 4 h", "5 h 12 m", "12 m" until `at`; null once it has passed. */
export function timeLeft(at: string, now: number): string | null {
  const ms = Date.parse(at) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return `${d} d ${h} h`;
  return h > 0 ? `${h} h ${min % 60} m` : `${min} m`;
}

/**
 * The season's pulse under the clip: its number and time left, and only the counts that are not
 * zero (matches live now, players ranked), so a quiet testnet never reads as an empty one.
 */
function SeasonPulse() {
  const current = useCurrentSeason();
  const season = current.data?.season;
  const standings = useSeasonStandings(season?.id, { limit: 1 });
  const live = useV2LiveMatches();
  if (!season || season.status !== 'open') return null;
  const left = timeLeft(season.endsAt, Date.now());
  const liveNow = Array.isArray(live.data) ? live.data.length : 0;
  const ranked = standings.data?.total ?? 0;
  const parts = [`Season ${season.number}`, left ? `ends in ${left}` : 'ending now'];
  if (liveNow > 0) parts.push(`${liveNow} ${liveNow === 1 ? 'match' : 'matches'} live now`);
  if (ranked > 0) parts.push(`${ranked} ${ranked === 1 ? 'player' : 'players'} ranked`);
  return (
    <p className="s01-pulse" data-testid="s01-pulse">
      <Icon name="trophy" />
      <span>{parts.join(' · ')}</span>
      <Link href={routes.leaderboards()} className="app-link-strong">
        Top 10 split the prize pool
      </Link>
    </p>
  );
}

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

  /**
   * Sign in, then open practice vs the bot. privy: Google at once (one click). dev: the typed handle,
   * or focus the empty field and say what happens next.
   */
  function startPractice() {
    practiceIntent.current = true;
    setPracticeArmed(true);
    if (session.mode !== 'dev') {
      void signIn('google');
      return;
    }
    const form = actionsRef.current?.querySelector<HTMLFormElement>('form');
    const handle = form?.querySelector<HTMLInputElement>('input[name="handle"]');
    if (form && handle && handle.value.trim() !== '') form.requestSubmit();
    else {
      handle?.focus();
      handle?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }

  const practiceButton = (testId: string, label = 'Play a free match') => (
    <Button
      variant="primary"
      size="lg"
      block
      icon="play"
      loading={practiceArmed && pending !== null && pending !== 'email'}
      disabled={disabled}
      onClick={startPractice}
      data-testid={testId}
    >
      {label}
    </Button>
  );

  return (
    <div className="s01" data-testid="screen-s01">
      <header className="s01-header">
        <div className="app-row">
          <Logo size={28} />
          <Badge data-testid="s01-network">{NETWORK_LABEL}</Badge>
        </div>
        <Link href={routes.leaderboards()} className="app-link-strong s01-ladder" aria-label="See the season ladder, no sign-in" data-testid="s01-ladder">
          <Icon name="trophy" />
          <span className="s01-ladder-text">See the season ladder, no sign-in</span>
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
            <div className="s01-practice" data-testid="s01-practice">
              {session.mode === 'dev' ? null : practiceButton('s01-practice-start')}
              <p className="s01-practice-name">{PRACTICE_LINE}.</p>
              <p className="s01-practice-meta">
                Your crew against the {BOT_HANDLE}. It starts at once, with no matchmaking, Elo or ladder at stake.
              </p>
              {practiceArmed && pending === null && session.mode === 'dev' ? (
                <p className="s01-practice-hint" role="status" data-testid="s01-practice-hint">
                  Pick a handle below. Your practice match opens right after.
                </p>
              ) : null}
            </div>

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
                {practiceButton('s01-practice-start')}
                <Button type="submit" size="lg" block loading={pending === 'dev' && !practiceArmed} disabled={disabled} data-testid="s01-signin">
                  Sign in
                </Button>
              </form>
            ) : (
              <div className="s01-signin-row">
                <span className="s01-or">Or sign in</span>
                <div className="s01-form s01-form-row">
                  <Button
                    loading={pending === 'google' && !practiceArmed}
                    disabled={disabled}
                    onClick={() => {
                      practiceIntent.current = false;
                      setPracticeArmed(false);
                      void signIn('google');
                    }}
                    data-testid="s01-google"
                  >
                    Google
                  </Button>
                  <Button
                    loading={pending === 'email'}
                    disabled={disabled}
                    onClick={() => void signIn('email')}
                    data-testid="s01-email"
                  >
                    Email
                  </Button>
                </div>
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
            <SeasonPulse />
          </figure>
        </section>

        <Showreel cta={<div className="s01-reel-cta">{practiceButton('s01-reel-play', 'Play one yourself, free')}</div>} />

        {zamaConfig.enabled ? (
          <section className="app-card s01-zama" aria-labelledby="s01-zama-title" data-testid="s01-zama">
            <div className="s01-zama-head">
              <span className="s01-eyebrow">
                <Icon name="lock" /> Sealed on Zama
              </span>
              <h2 id="s01-zama-title" className="app-h3">
                What a public chain can&apos;t keep secret, skirm seals.
              </h2>
            </div>
            <ul className="s01-zama-list">
              <li>
                <b>Hidden loadouts.</b> Both crews lock in sealed, so nobody counter-picks.
              </li>
              <li>
                <b>Sealed bids.</b> Skill auctions in cSKIRM with no bid visible until the close.
              </li>
              <li>
                <b>Private rating.</b> Your exact rating stays encrypted; the ladder shows only your tier.
              </li>
            </ul>
            <div className="s01-step-links">
              <Link href={routes.verify()} className="app-link-strong" data-testid="s01-zama-verify">
                Verify a sealed match
              </Link>
              <Link href={routes.fog()} className="app-link-strong" data-testid="s01-zama-fog">
                Try Fog Skirm
              </Link>
            </div>
          </section>
        ) : null}

        <section aria-label="How it works" className="s01-steps" data-testid="s01-steps">
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">1</span>
              <h2 className="app-h3">Write a skill</h2>
            </div>
            <p className="sk-muted">
              A strategy in plain words. Mint it as an NFT on NEAR and sell it: resales pay you a royalty, and buyers run
              it without ever seeing your text.
            </p>
            <div className="s01-step-links">
              <Link href={routes.market()} className="app-link-strong" data-testid="s01-market">
                Browse the Exchange
              </Link>
            </div>
          </article>
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">2</span>
              <h2 className="app-h3">Your crew plays it</h2>
            </div>
            <p className="sk-muted">
              Each agent has a role, sight and voice range. Two-second ticks, five minutes at most, and rivals near a
              speaker overhear it.
            </p>
            <div className="app-row s01-step-links">
              <AgentAvatar size={32} label="Rook" role="Builder" body="#8fa8ff" crew="a" />
              <span className="sk-mono sk-muted">Rook · Builder · Standard</span>
            </div>
          </article>
          <article className="app-card s01-step">
            <div className="app-row">
              <span className="s01-step-num">3</span>
              <h2 className="app-h3">Results on NEAR</h2>
            </div>
            <p className="sk-muted">
              Every ranked result is recorded on NEAR {NETWORK_LABEL.toLowerCase()} with its Elo change, so anyone can
              check a match. Each 14-day season&apos;s top 10 split the prize pool.
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
        <p className="s01-legal" data-testid="s01-legal">
          {NETWORK_LABEL}. By playing you accept the <Link href={routes.terms()}>terms</Link>; how your data is used is in the{' '}
          <Link href={routes.privacy()}>privacy policy</Link>. New here? Read the{' '}
          <Link href={routes.docs()} data-testid="s01-docs">
            docs
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
