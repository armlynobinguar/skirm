// Every screen except S01 sits in the app shell (shared header + main column).
// Route groups below it — (play), (skills), (pvp), (account) — only organise ownership; they add
// no layout. Do not add per-group layouts that re-render the header.
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
