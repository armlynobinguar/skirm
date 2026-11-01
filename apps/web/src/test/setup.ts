// Vitest setup: jest-dom matchers, a mocked next/navigation (src/test/router.ts), cleanup between
// tests, and a clean localStorage.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { testRouter } from './router';

// Node 25+ has its own global localStorage/sessionStorage, undefined unless --localstorage-file is
// given, and it shadows jsdom's. Point both back at jsdom's (a no-op on older Node).
const dom = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, value: dom[key] });
}

// jsdom has no 2D canvas and logs "Not implemented" on getContext; canvases draw nothing in tests.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// Replay screens rebuild and verify the whole run with the engine; under turbo's parallel load that
// can take longer than Testing Library's 1 s default for findBy*/waitFor.
configure({ asyncUtilTimeout: 5000 });

vi.mock('next/navigation', () => ({
  useRouter: () => testRouter,
  usePathname: () => testRouter.pathname,
  useSearchParams: () => new URLSearchParams(testRouter.search),
  useParams: () => ({}),
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`);
  },
  notFound: () => {
    throw new Error('notFound()');
  },
}));

afterEach(() => {
  cleanup();
  testRouter.reset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});
