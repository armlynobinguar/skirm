'use client';
// HUD top bar (v2 Arena look, the prototype's #top). Back, logo, the section tabs and the SFX and
// Notes toggles are separate chips over the arena, in three groups, on a dark glass band so scrolled
// content never shows through behind them. Tabs carry a code-drawn icon (AkIcon) and a serial code
// (PLY·01 to LDR·05). Groups: Back, logo and a crumb naming the screen; the nav; and the toggles with
// the account badge last (AccountDock.tsx: handle and credits; a click opens the card with network,
// credits, wallet and Elo). Under 720px the five tabs fold into a Menu button that drops them as a
// list, and the toggles show their icon only. Every screen except S01 renders it via AppShell.
import { AkIcon, Logo, type AkIconName } from '@skirm/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/lib/preferences';
import { navGroupOf, routes, screenOf, type NavGroup } from '@/lib/routes';
import { sfxEngine, useSfx } from '@/lib/sfx';
import { AccountDock } from './AccountDock';
import { notesStore, useNotesOpen } from './notes';
import { matchBack } from '@/lib/match-origin';
import { config } from '@/lib/config';

const NAV: { id: NavGroup; label: string; href: string; icon: AkIconName; serial: string }[] = [
  { id: 'play', label: 'Play', href: routes.home(), icon: 'play', serial: 'PLY·01' },
  { id: 'skills', label: 'Skills', href: routes.skills(), icon: 'mine', serial: 'SKL·02' },
  { id: 'market', label: 'Exchange', href: routes.market(), icon: 'market', serial: 'MKT·03' },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const activeLabel = NAV.find((n) => n.id === active)?.label;

  // The narrow-screen menu closes on navigation, on Escape and on a press outside it.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Taken here, like the account card, so Escape does not also go Back (GlobalKeys).
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setMenuOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (menuRoot.current && !menuRoot.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

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
              router.push(matchBack(pathname, screen.back!));
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
      <div className="app-topbar-navwrap" ref={menuRoot}>
        <button
          type="button"
          className="app-topbar-menu app-topbar-chip"
          aria-expanded={menuOpen}
          aria-controls="app-topbar-nav"
          aria-label={activeLabel ? `Menu, now on ${activeLabel}` : 'Menu'}
          data-testid="topbar-menu"
          onClick={() => {
            sfx.play('click');
            setMenuOpen((o) => !o);
          }}
        >
          <svg viewBox="0 0 18 14" width="18" height="14" aria-hidden="true">
            <path d={menuOpen ? 'M3 1l12 12M15 1L3 13' : 'M1 1h16M1 7h16M1 13h16'} stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
          <span>{activeLabel ?? 'Menu'}</span>
        </button>
        <nav aria-label="Main" id="app-topbar-nav" className="app-topbar-grp app-topbar-nav" data-open={menuOpen ? '' : undefined}>
          {NAV.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="app-topbar-link app-topbar-chip"
              data-testid={`nav-${item.id}`}
              onClick={() => setMenuOpen(false)}
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
      </div>
      <div className="app-topbar-grp app-topbar-right">
        <button
          type="button"
          className="app-topbar-toggle app-topbar-chip"
          aria-pressed={prefs.sfx}
          aria-label="Sound effects"
          title={prefs.sfx ? 'Sound effects: on' : 'Sound effects: off'}
          data-testid="topbar-sfx"
          onClick={() => {
            // Confirm with a click when turning sound on; turning it off is silent.
            if (!prefs.sfx) sfxEngine().play('click');
            set({ sfx: !prefs.sfx });
          }}
        >
          <AkIcon name="sfx" />
          <span className="app-topbar-toggle-label">SFX</span>
        </button>
        {config.designNotes ? (
          <button
            type="button"
            className="app-topbar-toggle app-topbar-notes app-topbar-chip"
            aria-pressed={notesOpen}
            aria-label="Design notes"
            title="Design notes (N)"
            data-testid="topbar-notes"
            onClick={() => {
              notesStore.toggle();
              sfx.play('click');
            }}
          >
            <AkIcon name="notes" />
            <span className="app-topbar-toggle-label">Notes</span>
          </button>
        ) : null}
        <AccountDock />
      </div>
    </header>
  );
}
