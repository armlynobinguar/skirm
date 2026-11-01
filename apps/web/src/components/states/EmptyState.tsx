// One line + one action (UI/UX Spec States, Empty).
import type { ReactNode } from 'react';

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <section className="app-card app-empty" data-testid="empty-state">
      <p>{children}</p>
      {action}
    </section>
  );
}
