'use client';
// The account badge, the last chip group of the top bar: the network diamond, your handle and your
// credits. Clicking it opens the account card under it: the network, your handle (links to your
// profile), then three cells: credits with the free allowance and held amount, the NEAR wallet
// (linked account and its balance, read from the chain), and ranked Elo with its rank title. The card
// stays in the DOM while closed (hidden), so its figures are always readable by tests. Escape, a
// click outside, a link inside and a route change close it. The last row reopens the tutorial (its
// permanent entry point, once First steps is dismissed) and signs out. Signed out, the badge is a Sign
// in link. Credits on the badge and the card count paid credits plus today's free allowance, so a new
// player sees what they can spend rather than 0.
// Hidden on the live match and run screens, whose HUD owns the screen. The test ids keep their
// topbar- names (e2e and the smoke use them).
import { fmt } from '@skirm/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { TierBadge, tierFrom, tierText } from '@/components/TierBadge';
import { nearShort, useNearBalance } from '@/features/play/useNearBalance';
import { useMe } from '@/lib/api/queries';
import type { Me } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { DAILY_FREE_ALLOWANCE } from '@/lib/constants';
import { navGroupOf, routes, screenOf } from '@/lib/routes';

/** Screens with a full-screen HUD: the badge stays off them. */
const LIVE_SCREENS = new Set(['match']);

export function AccountDock() {
  const pathname = usePathname() ?? '/';
  const screen = screenOf(pathname);
  const session = useSession();
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A route change closes the card.
  useEffect(() => setOpen(false), [pathname]);

  // Escape and a click outside close it. Escape is taken here so it does not also go Back.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (screen && LIVE_SCREENS.has(screen.key)) return null;
  const credits = me.data?.credits;
  const handle = me.data?.account.handle ?? session.handle ?? 'Account';
  const network = config.near.network === 'testnet' ? 'Testnet' : 'Mainnet';
  const netTitle = `Every match and purchase runs on NEAR ${config.near.network}`;

  if (session.status !== 'signedIn')
    return (
      <div className="app-acct" data-testid="account-dock">
        {session.status === 'signedOut' ? (
          <Link href={routes.signIn()} className="app-acct-badge app-topbar-chip" data-testid="topbar-signin">
            <span className="app-dock-net" title={netTitle}>
              <i aria-hidden="true" />
              {network}
            </span>
            <b className="app-acct-handle">Sign in</b>
          </Link>
        ) : null}
      </div>
    );

  return (
    <div className="app-acct" ref={root} data-testid="account-dock">
      <button
        type="button"
        className="app-acct-badge app-topbar-chip"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${handle}`}
        title={`${handle} · ${network}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="account-badge"
      >
        <i className="app-acct-dia" aria-hidden="true" />
        <b className="app-acct-handle">{handle}</b>
        {me.data ? <TierBadge tier={tierFrom(me.data.rank)} size="sm" testId="topbar-tier" /> : null}
        {credits ? (
          <span className="app-acct-cr" title={creditsTitle(credits)} data-testid="topbar-cr">
            {fmt(spendable(credits))} CR
          </span>
        ) : null}
        <svg className="app-acct-chev" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <aside
        id={panelId}
        className="app-dock"
        aria-label="Account"
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        <div className="app-dock-head">
          <span className="app-dock-net" title={netTitle}>
            <i aria-hidden="true" />
            {network}
          </span>
          <Link
            href={routes.account()}
            className="app-dock-handle"
            title={handle}
            data-testid="topbar-account"
            {...(navGroupOf(pathname) === 'account' ? { 'aria-current': 'page' as const } : {})}
          >
            {handle}
          </Link>
        </div>
        <div className="app-dock-stats">
          <Link href={routes.credits()} className="app-dock-cell" data-testid="topbar-credits">
            <small>Credits</small>
            {credits ? (
              <>
                <b title={creditsTitle(credits)}>{fmt(spendable(credits))}</b>
                <span
                  data-testid="topbar-allowance"
                  title={`${credits.allowanceLeft} of ${DAILY_FREE_ALLOWANCE} free credits left today`}
                >
                  {fmt(credits.balance)} paid · {fmt(credits.allowanceLeft)} free
                  {credits.held > 0 ? ` · ${fmt(credits.held)} held` : ''}
                </span>
              </>
            ) : (
              <span className="app-skeleton app-dock-skeleton" aria-label="Loading credits" />
            )}
          </Link>
          <WalletCell me={me.data} />
          <EloCell me={me.data} />
        </div>
        <div className="app-dock-foot">
          <Link href={routes.tutorial()} className="app-dock-signout app-dock-tutorial" data-testid="topbar-tutorial">
            Tutorial
          </Link>
          <button
            type="button"
            className="app-dock-signout"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await session.signOut();
              } finally {
                setSigningOut(false);
                setOpen(false);
                router.push(routes.signIn());
              }
            }}
            data-testid="topbar-sign-out"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
    </div>
  );
}

type Credits = NonNullable<Me['credits']>;

/** What the player can spend now: paid credits plus today's free allowance (new players have 0 paid). */
const spendable = (c: Credits) => c.balance + c.allowanceLeft;

const creditsTitle = (c: Credits) =>
  `${fmt(c.balance)} paid + ${fmt(c.allowanceLeft)} of ${DAILY_FREE_ALLOWANCE} free today${c.held > 0 ? ` · ${fmt(c.held)} held for a match` : ''}`;

/** The linked NEAR account and its liquid balance; links to the profile, where M01 links one. */
function WalletCell({ me }: { me: Me | undefined }) {
  const nearId = me?.account.nearAccountId ?? null;
  const balance = useNearBalance(nearId);
  let value: string;
  let sub: string | null = null;
  let title: string;
  if (!me) {
    value = '…';
    title = 'Loading wallet';
  } else if (!nearId) {
    value = 'Not linked';
    sub = 'Link on your profile';
    title = 'Link a NEAR wallet on your profile';
  } else if (balance.data === undefined) {
    value = balance.isError ? '–' : '…';
    sub = nearId;
    title = balance.isError ? `${nearId}: balance unavailable` : `${nearId}: loading balance`;
  } else if (balance.data === null) {
    value = '–';
    sub = `${nearId} · not on ${config.near.network}`;
    title = `${nearId} has no account on NEAR ${config.near.network} yet`;
  } else {
    value = `${nearShort(balance.data)} Ⓝ`;
    sub = nearId;
    title = `${nearId}: ${nearShort(balance.data)} NEAR in the wallet`;
  }
  return (
    <Link href={routes.account()} className="app-dock-cell" title={title} data-testid="topbar-wallet">
      <small>Wallet</small>
      <b>{value}</b>
      {sub ? <span>{sub}</span> : null}
    </Link>
  );
}

/** Ranked Elo with its tier and rank title; links to the Skirmish hub (ladder, record). */
function EloCell({ me }: { me: Me | undefined }) {
  const elo = me?.rank.elo;
  const rank = me?.rank.title ?? null;
  const tier = me ? tierText(tierFrom(me.rank)) : null;
  return (
    <Link href={routes.pvp()} className="app-dock-cell" title={rank ? `${tier} · ${rank} · Ranked Elo ${elo}` : 'Ranked Elo'} data-testid="topbar-elo">
      <small>Ranked Elo</small>
      <b>{elo === undefined ? '–' : elo}</b>
      {rank ? <span>{tier ? `${tier} · ${rank}` : rank}</span> : null}
    </Link>
  );
}
