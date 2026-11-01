// A stand-in for next/navigation in component tests (mocked in ./setup.ts). Tests read and drive it:
//   testRouter.pathname = '/maps/flood-gate';  … expect(testRouter.replace).toHaveBeenCalledWith('/play')
import { vi } from 'vitest';

export const testRouter = {
  pathname: '/',
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  reset(pathname = '/', search = '') {
    this.pathname = pathname;
    this.search = search;
    for (const f of [this.push, this.replace, this.back, this.forward, this.refresh, this.prefetch]) f.mockReset();
  },
};
