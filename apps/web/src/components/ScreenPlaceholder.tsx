// Stand-in for a screen a builder has not built yet. Delete it from the screen once it is real.
// Keeps the root data-testid (`screen-<id>`) that e2e tests and the real screen share.
import type { ReactNode } from 'react';

export interface ScreenPlaceholderProps {
  /** Spec screen id, e.g. "S03". */
  id: string;
  title: string;
  /** Artboard in .design-src/screens. */
  artboard: string;
  purpose: string;
  children?: ReactNode;
}

export function ScreenPlaceholder({ id, title, artboard, purpose, children }: ScreenPlaceholderProps) {
  return (
    <section className="app-page" data-testid={`screen-${id.toLowerCase()}`}>
      <p className="sk-eyebrow">
        {id} · not built yet
      </p>
      <h1 className="app-h1">{title}</h1>
      <p className="sk-muted">{purpose}</p>
      <p className="sk-muted app-small">
        Design: <code>.design-src/screens/{artboard}</code>
      </p>
      {children}
    </section>
  );
}
