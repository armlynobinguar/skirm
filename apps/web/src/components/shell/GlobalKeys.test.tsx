import { Modal } from '@skirm/ui';
import { act, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AppShell } from './AppShell';
import { topEscapeLayer, useEscapeLayer, useStartKey, type EscapeLayer } from './GlobalKeys';
import { notesStore } from './notes';

afterEach(() => act(() => notesStore.set(false)));

/** Let GlobalKeys' deferred Back (it waits for the event to finish) run. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

function Layer({ layer, onEscape }: { layer: EscapeLayer; onEscape?: () => void }) {
  useEscapeLayer(layer, true, onEscape);
  return null;
}

describe('GlobalKeys', () => {
  it('N toggles the design notes for the current screen', async () => {
    const { user } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/maps/copper-hollow/crew' });
    await user.keyboard('n');
    expect(screen.getByTestId('notes-aside')).toHaveTextContent('Lock in');
    expect(screen.getByTestId('notes-aside')).toHaveTextContent('From the Command Deck');
    expect(screen.getByTestId('topbar-notes')).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('N');
    expect(screen.queryByTestId('notes-aside')).not.toBeInTheDocument();
  });

  it('leaves N and Escape alone while typing in a field', async () => {
    const { user, router } = renderWithProviders(
      <AppShell>
        <input aria-label="Search" />
      </AppShell>,
      { path: '/market' },
    );
    await user.click(screen.getByLabelText('Search'));
    await user.keyboard('n{Escape}');
    await settle();
    expect(screen.queryByTestId('notes-aside')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('Escape goes Back to the screen the Back button names', async () => {
    const { user, router } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/matches/m_1/result' });
    await user.keyboard('{Escape}');
    await settle();
    expect(router.push).toHaveBeenCalledWith('/pvp');
  });

  it('Escape does nothing on the Command deck (no Back)', async () => {
    const { user, router } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/play' });
    await user.keyboard('{Escape}');
    await settle();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('Escape closes an open modal first, then goes Back on the next press', async () => {
    function WithModal() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Buy skill">
          body
        </Modal>
      );
    }
    const { user, router } = renderWithProviders(
      <AppShell>
        <WithModal />
      </AppShell>,
      { path: '/market' },
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await settle();
    expect(router.push).toHaveBeenCalledWith('/play');
  });

  it('Escape goes to the top escape layer: intro before third person, the takeover before both', async () => {
    const intro = vi.fn();
    const tpv = vi.fn();
    let setActive: (l: EscapeLayer[]) => void = () => {};
    function Layers() {
      const [active, set] = useState<EscapeLayer[]>(['tpv', 'intro']);
      setActive = set;
      return (
        <>
          {active.includes('tpv') ? <Layer layer="tpv" onEscape={tpv} /> : null}
          {active.includes('intro') ? <Layer layer="intro" onEscape={intro} /> : null}
          {active.includes('takeover') ? <Layer layer="takeover" /> : null}
        </>
      );
    }
    const { user, router } = renderWithProviders(
      <AppShell>
        <Layers />
      </AppShell>,
      { path: '/matches/m_1' },
    );
    expect(topEscapeLayer()).toBe('intro');
    await user.keyboard('{Escape}');
    await settle();
    expect(intro).toHaveBeenCalledTimes(1);
    expect(tpv).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    // The takeover only swallows Escape (decide with its buttons).
    act(() => setActive(['tpv', 'intro', 'takeover']));
    expect(topEscapeLayer()).toBe('takeover');
    await user.keyboard('{Escape}');
    await settle();
    expect(intro).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();

    act(() => setActive(['tpv']));
    await user.keyboard('{Escape}');
    await settle();
    expect(tpv).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();

    act(() => setActive([]));
    expect(topEscapeLayer()).toBeNull();
    await user.keyboard('{Escape}');
    await settle();
    expect(router.push).toHaveBeenCalledWith('/pvp');
  });

  it("a screen's own Escape handler (preventDefault) wins over Back", async () => {
    const cancel = vi.fn();
    function Search() {
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          cancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);
      return null;
    }
    const { user, router } = renderWithProviders(
      <AppShell>
        <Search />
      </AppShell>,
      { path: '/pvp' },
    );
    await user.keyboard('{Escape}');
    await settle();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('useStartKey', () => {
  function Start({ active, onStart }: { active: boolean; onStart: () => void }) {
    useStartKey(active, onStart);
    return <button type="button">Other</button>;
  }

  it('runs on Enter or Space while active, but not from a button or while inactive', async () => {
    const onStart = vi.fn();
    const { user, rerender } = renderWithProviders(<Start active onStart={onStart} />);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onStart).toHaveBeenCalledTimes(2);
    screen.getByRole('button', { name: 'Other' }).focus();
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledTimes(2);
    (document.activeElement as HTMLElement).blur();
    rerender(<Start active={false} onStart={onStart} />);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(2));
  });
});
