'use client';
// HUD top bar (v2 Arena look, the prototype's #top). There is no bar: Back, logo, the section tabs
// and the SFX and Notes toggles are separate chips floating over the arena, in three groups. Tabs
// carry a code-drawn icon (AkIcon) and a serial code (PLY·01 to LDR·05). Groups: Back, logo and a
// crumb naming the screen; the nav; and the toggles with the account badge last (AccountDock.tsx:
// handle and credits; a click opens the card with network, credits, wallet and Elo). Every screen
// except S01 renders it via AppShell.
import { AkIcon, Logo, type AkIconName } from '@skirm/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePreferences } from '@/lib/preferences';
import { navGroupOf, routes, screenOf, type NavGroup } from '@/lib/routes';
import { sfxEngine, useSfx } from '@/lib/sfx';
import { AccountDock } from './AccountDock';
import { notesStore, useNotesOpen } from './notes';

const NAV: { id: NavGroup; label: string; href: string; icon: AkIconName; serial: string }[] = [
  { id: 'play', label: 'Play', href: routes.home(), icon: 'play', serial: 'PLY·01' },
  { id: 'skills', label: 'My skills', href: routes.skills(), icon: 'mine', serial: 'SKL·02' },
  { id: 'market', label: 'Market', href: routes.market(), icon: 'market', serial: 'MKT·03' },
  { id: 'pvp', label: 'PvP', href: routes.pvp(), icon: 'pvp', serial: 'PVP·04' },
  { id: 'leaderboards', label: 'Leaderboards', href: routes.leaderboards(), icon: 'lb', serial: 'LDR·05' },
];

export function TopBar() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const active = navGroupOf(pathname);
  const screen = screenOf(pathname);
  const { prefs, set } = usePreferences();
  const sfx = useSfx();
  const notesOpen = useNotesOpen();

  return (
    <header className="app-topbar" data-testid="topbar">
      <div className="app-topbar-grp">
        {screen?.back ? (
          <button
            type="button"
            className="app-topbar-back app-topbar-chip"
            aria-label="Back"
            title="Back"
            data-testid="topbar-back"
            onClick={() => {
              sfx.play('click');
              router.push(screen.back!);
            }}
          >
            <AkIcon name="back" />
          </button>
        ) : null}
        <Link href={routes.home()} aria-label="skirm home" className="app-topbar-logo">
          <Logo size={26} />
        </Link>
        {screen ? (
          <span className="app-topbar-crumb" data-testid="topbar-crumb">
            / {screen.title}
          </span>
        ) : null}
      </div>
      <nav aria-label="Main" className="app-topbar-grp app-topbar-nav">
        {NAV.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="app-topbar-link app-topbar-chip"
            data-testid={`nav-${item.id}`}
            {...(active === item.id ? { 'aria-current': 'page' as const } : {})}
          >
            <span className="sk-ni">
              <AkIcon name={item.icon} />
            </span>
            <span>{item.label}</span>
            <i className="app-topbar-serial" aria-hidden="true">
              {item.serial}
            </i>
          </Link>
        ))}
      </nav>
      <div className="app-topbar-grp app-topbar-right">
        <button
          type="button"
          className="app-topbar-toggle app-topbar-chip"
          aria-pressed={prefs.sfx}
          title="Sound effects"
          data-testid="topbar-sfx"
          onClick={() => {
            // Confirm with a click when turning sound on; turning it off is silent.
            if (!prefs.sfx) sfxEngine().play('click');
            set({ sfx: !prefs.sfx });
          }}
        >
          <AkIcon name="sfx" />
          SFX
        </button>
        <button
          type="button"
          className="app-topbar-toggle app-topbar-chip"
          aria-pressed={notesOpen}
          title="Design notes (N)"
          data-testid="topbar-notes"
          onClick={() => {
            notesStore.toggle();
            sfx.play('click');
          }}
        >
          <AkIcon name="notes" />
          Notes
        </button>
        <AccountDock />
      </div>
    </header>
  );
}

