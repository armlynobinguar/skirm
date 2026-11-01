import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '@/lib/preferences';
import { testRouter } from '@/test/router';
import { RouteWipe, WIPE_MS } from './RouteWipe';

describe('RouteWipe', () => {
  it('plays when the screen changes, names the new screen, then clears', () => {
    vi.useFakeTimers();
    try {
      testRouter.pathname = '/play';
      const { rerender } = render(<RouteWipe />);
      expect(screen.queryByTestId('route-wipe')).not.toBeInTheDocument(); // not on first render

      testRouter.pathname = '/market/skl_1';
      rerender(<RouteWipe />);
      expect(screen.getByTestId('route-wipe')).toHaveTextContent('Exchange// proof first');

      act(() => vi.advanceTimersByTime(WIPE_MS));
      expect(screen.queryByTestId('route-wipe')).not.toBeInTheDocument();

      testRouter.pathname = '/market'; // same screen: no wipe
      rerender(<RouteWipe />);
      expect(screen.queryByTestId('route-wipe')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never plays with reduced motion on', () => {
    act(() => preferencesStore().set({ reducedMotion: true }));
    testRouter.pathname = '/play';
    const { rerender } = render(<RouteWipe />);
    testRouter.pathname = '/pvp';
    rerender(<RouteWipe />);
    expect(screen.queryByTestId('route-wipe')).not.toBeInTheDocument();
    act(() => preferencesStore().set({ reducedMotion: null }));
  });
});
