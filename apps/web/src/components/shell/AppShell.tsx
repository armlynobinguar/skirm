// Signed-in screen frame: the persistent arena canvas, skip link, the HUD top bar, main column, the
// account card, the screen wipe, the design notes aside and the global keys (N, Escape). Used by
// src/app/(shell)/layout.tsx, so every route under (shell) gets it; S01 (src/app/page.tsx) does not.
// Next keeps this layout mounted across (shell) navigations, so the arena never unmounts.
import type { ReactNode } from 'react';
import { ArenaCanvas } from '@/features/arena/ArenaCanvas';
import { AccountDock } from './AccountDock';
import { GlobalKeys } from './GlobalKeys';
import { NotesAside } from './NotesAside';
import { RouteWipe } from './RouteWipe';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <ArenaCanvas />
      <a href="#main" className="app-skip">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <AccountDock />
      <RouteWipe />
      <NotesAside />
      <GlobalKeys />
    </div>
  );
}
