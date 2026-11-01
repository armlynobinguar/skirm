'use client';
// Global toasts. `const toast = useToast();` then
//   toast.show({ tone: 'good', title: 'Saved', message: 'Saved 14:02' })
//   toast.error(err)          // ApiError → player-facing copy, code under "Details"
// Non-critical toasts auto-dismiss (@skirm/ui Toast, motion.md duration-toast); critical ones stay.
import { Toast } from '@skirm/ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { errorCopy } from '@/lib/api/errors';

export type ToastTone = 'neutral' | 'good' | 'warning' | 'critical';

export interface ToastInput {
  tone?: ToastTone;
  title?: string;
  message?: ReactNode;
  /** e.g. a <Button size="sm"> (Retry, Top up). */
  action?: ReactNode;
  /** Error code shown in a Details disclosure for support. */
  code?: string;
  /** 0 keeps it until dismissed. */
  autoDismissMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

export interface ToastApi {
  show(t: ToastInput): number;
  error(err: unknown, override?: Partial<ToastInput>): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    return id;
  }, []);
  const error = useCallback(
    (err: unknown, override?: Partial<ToastInput>) => {
      const c = errorCopy(err);
      return show({ tone: 'critical', title: c.title, message: c.message, ...(c.code ? { code: c.code } : {}), ...override });
    },
    [show],
  );
  const api = useMemo(() => ({ show, error, dismiss }), [show, error, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="app-toasts" data-testid="toasts" aria-live="polite">
        {items.map((t) => (
          <Toast
            key={t.id}
            tone={t.tone ?? 'neutral'}
            {...(t.title ? { title: t.title } : {})}
            {...(t.action ? { action: t.action } : {})}
            {...(t.autoDismissMs !== undefined ? { autoDismissMs: t.autoDismissMs } : {})}
            onClose={() => dismiss(t.id)}
          >
            {t.message}
            {t.code ? (
              <details className="app-toast-details">
                <summary>Details</summary>
                <code>{t.code}</code>
              </details>
            ) : null}
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const t = useContext(ToastContext);
  if (!t) throw new Error('useToast: wrap the tree in <Providers>');
  return t;
}
