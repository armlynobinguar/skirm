'use client';
// The account card, pinned bottom right over the arena (on phones it closes the page instead): the
// network, your handle (links to your profile) or a Sign in link, then three cells: credits with the
// free allowance and held amount, the NEAR wallet (linked account and its balance, read from the
// chain), and ranked Elo with its rank title. Hidden on the live match and run screens, whose HUD
// owns the bottom of the screen. The test ids keep their topbar- names (e2e and the smoke use them).
import { fmt } from '@skirm/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { nearShort, useNearBalance } from '@/features/play/useNearBalance';
import { useMe } from '@/lib/api/queries';
import type { Me } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { DAILY_FREE_ALLOWANCE } from '@/lib/constants';
import { navGroupOf, routes, screenOf } from '@/lib/routes';

/** Screens with a full-screen HUD: the card stays off them. */
const LIVE_SCREENS = new Set(['match']);

export function AccountDock() {
  const pathname = usePathname() ?? '/';
  const screen = screenOf(pathname);
  const session = useSession();
  const me = useMe();
  if (screen && LIVE_SCREENS.has(screen.key)) return null;
  const credits = me.data?.credits;
  const handle = me.data?.account.handle ?? session.handle ?? 'Account';

  return (
    <aside className="app-dock" aria-label="Account" data-testid="account-dock">
      <div className="app-dock-head">
        <span className="app-dock-net" title={`Every match and purchase runs on NEAR ${config.near.network}`}>
          <i aria-hidden="true" />
          {config.near.network === 'testnet' ? 'Testnet' : 'Mainnet'}
        </span>
        {session.status === 'signedIn' ? (
          <Link
            href={routes.account()}
            className="app-dock-handle"
            title={handle}
            data-testid="topbar-account"
            {...(navGroupOf(pathname) === 'account' ? { 'aria-current': 'page' as const } : {})}
          >
            {handle}
          </Link>
        ) : session.status === 'signedOut' ? (
          <Link href={routes.signIn()} className="app-dock-handle" data-testid="topbar-signin">
            Sign in
          </Link>
        ) : null}
      </div>
      {session.status === 'signedIn' ? (
        <div className="app-dock-stats">
          <Link href={routes.credits()} className="app-dock-cell" data-testid="topbar-credits">
            <small>Credits</small>
            {credits ? (
              <>
                <b>{fmt(credits.balance)}</b>
                <span
                  data-testid="topbar-allowance"
                  title={`${credits.allowanceLeft} of ${DAILY_FREE_ALLOWANCE} free credits left today`}
                >
                  {fmt(credits.allowanceLeft)} free
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
      ) : null}
    </aside>
  );
}

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

/** Ranked Elo and its rank title; links to the Skirmish hub (ladder, record). */
function EloCell({ me }: { me: Me | undefined }) {
  const elo = me?.rank.elo;
  const rank = me?.rank.title ?? null;
  return (
    <Link href={routes.pvp()} className="app-dock-cell" title={rank ? `${rank} · Ranked Elo ${elo}` : 'Ranked Elo'} data-testid="topbar-elo">
      <small>Ranked Elo</small>
      <b>{elo === undefined ? '–' : elo}</b>
      {rank ? <span>{rank}</span> : null}
    </Link>
  );
}
