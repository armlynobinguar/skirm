import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '@/lib/preferences';
import { renderWithProviders } from '@/test/render';
import { BOOT_MIN_MS, Boot } from './Boot';

afterEach(() => {
  vi.useRealTimers();
  act(() => preferencesStore().reset());
});

describe('Boot', () => {
  it('fills the loader, then offers Tap to sign in, which scrolls to the sign-in form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const target = document.createElement('section');
    target.id = 'signin';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    try {
      renderWithProviders(<Boot signInId="signin" />);
      expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
      expect(screen.getByTestId('s01-boot')).toHaveTextContent('SKIRM');
      await act(async () => {
        vi.advanceTimersByTime(BOOT_MIN_MS + 200);
      });
      const tap = await screen.findByTestId('s01-tap');
      expect(tap).toHaveTextContent('Tap to sign in');
      tap.click();
      expect(target.scrollIntoView).toHaveBeenCalled();
    } finally {
      target.remove();
    }
  });

  it('skips the fill with reduced motion and starts the Command deck when signed in', async () => {
    act(() => preferencesStore().set({ reducedMotion: true }));
    const { router } = renderWithProviders(<Boot signInId="signin" />, { handle: 'ada' });
    const tap = await screen.findByTestId('s01-tap');
    expect(tap).toHaveTextContent('Tap to start');
    tap.click();
    expect(router.push).toHaveBeenCalledWith('/play');
  });

  it('taps start with Enter once loaded, but leaves Space to scroll the page', async () => {
    act(() => preferencesStore().set({ reducedMotion: true }));
    const { router, user } = renderWithProviders(<Boot signInId="signin" />, { handle: 'ada' });
    await screen.findByTestId('s01-tap');
    await user.keyboard(' ');
    expect(router.push).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith('/play');
  });

  it('ignores Enter while the loader is still filling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { router } = renderWithProviders(<Boot signInId="signin" />, { handle: 'ada' });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(screen.queryByTestId('s01-tap')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
