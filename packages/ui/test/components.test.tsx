import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as ui from '../src';
import { Badge, Button, ICONS, Icon, Logo, Modal, TAG_MEANING, TILES, TagChip, Tabs, Toast, TopUpPanel, UnlockChip } from '../src';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tabs', () => {
  const tabs = [
    { id: 'skills', label: 'Skills', count: 12 },
    { id: 'owned', label: 'Owned' },
    { id: 'gone', label: 'Gone', disabled: true },
    { id: 'listed', label: 'Listed' },
  ];

  it('moves selection and focus with arrows, Home and End, skipping disabled tabs', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} label="Market" onChange={onChange} />);
    const list = screen.getByRole('tablist', { name: 'Market' });
    const tab = (name: string): HTMLElement => within(list).getByRole('tab', { name: new RegExp(name) });
    expect(tab('Skills').getAttribute('aria-selected')).toBe('true');
    expect(tab('Skills').tabIndex).toBe(0);
    expect(tab('Owned').tabIndex).toBe(-1);

    act(() => tab('Skills').focus());
    fireEvent.keyDown(tab('Skills'), { key: 'ArrowRight' });
    expect(tab('Owned').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Owned'));
    expect(onChange).toHaveBeenLastCalledWith('owned');

    fireEvent.keyDown(tab('Owned'), { key: 'ArrowRight' });
    expect(tab('Listed').getAttribute('aria-selected')).toBe('true'); // skipped the disabled tab
    fireEvent.keyDown(tab('Listed'), { key: 'ArrowRight' });
    expect(tab('Skills').getAttribute('aria-selected')).toBe('true'); // wraps
    fireEvent.keyDown(tab('Skills'), { key: 'ArrowLeft' });
    expect(tab('Listed').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Listed'), { key: 'Home' });
    expect(tab('Skills').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Skills'), { key: 'End' });
    expect(tab('Listed').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Listed'));
    expect(tab('Listed').tabIndex).toBe(0);
    expect(tab('Skills').tabIndex).toBe(-1);
  });

  it('is controllable', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="owned" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Owned' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('skills');
    expect(screen.getByRole('tab', { name: 'Owned' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Button', () => {
  it('shows tick squares, keeps its label and blocks clicks while loading', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button variant="primary" icon="wallet" loading onClick={onClick}>
        Waiting for wallet
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Waiting for wallet' });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.classList.contains('is-loading')).toBe(true);
    expect(container.querySelectorAll('.sk-tickdots i')).toHaveLength(3);
    expect(container.querySelector('[data-icon="wallet"]')).toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders icon, variant and size classes when idle', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button variant="danger" size="lg" icon="close" onClick={onClick}>
        Leave match
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Leave match' });
    expect(btn.className).toBe('sk-btn sk-btn-danger sk-btn-lg');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    expect(container.querySelector('[data-icon="close"]')!.getAttribute('width')).toBe('18');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Brand, data and small components', () => {
  it('Logo names the game skirm', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('.sk-logo-word')!.textContent).toBe('skirm');
    cleanup();
    render(<Logo markOnly />);
    expect(screen.getByRole('img', { name: 'skirm' })).toBeTruthy();
  });

  it('Icon covers the full set from the reference bundle', () => {
    expect(Object.keys(ICONS)).toHaveLength(43);
    render(<Icon name="tag_spreads" title="spreads" />);
    expect(screen.getByRole('img', { name: 'spreads' })).toBeTruthy();
  });

  it('TILES maps chars to things and tags', () => {
    const water = TILES.find((t) => t.ch === '~')!;
    expect(water).toMatchObject({ kind: 'water', things: ['water'], tags: ['spreads', 'liquid'] });
    expect(TILES.find((t) => t.ch === '*')!.things).toEqual(['gem', 'key', 'crystal']);
    expect(Object.keys(TAG_MEANING)).toHaveLength(10);
  });

  it('TagChip carries the meaning; UnlockChip accepts engine ids', () => {
    render(<TagChip tag="spreads" />);
    expect(screen.getByTitle(TAG_MEANING.spreads)).toBeTruthy();
    cleanup();
    render(<UnlockChip unlock="builder" state="missing" />);
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('not on map')).toBeTruthy();
  });

  it('Badge tone shows its icon; you badge does not', () => {
    const { container } = render(<Badge tone="critical">Goal flooded</Badge>);
    expect(container.querySelector('[data-icon="critical"]')).not.toBeNull();
    cleanup();
    const r = render(<Badge tone="you">You</Badge>);
    expect(r.container.querySelector('.sk-icon')).toBeNull();
  });

  it('Modal closes on Escape and returns focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender } = render(<Modal open title="Top up credits" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Top up credits' });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(<Modal open={false} title="Top up credits" onClose={onClose} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Modal traps Tab and Shift+Tab inside and honours initialFocus', () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    function Demo() {
      const okRef = React.useRef<HTMLButtonElement>(null);
      return (
        <Modal
          open
          title="Confirm"
          onClose={() => undefined}
          initialFocus={okRef}
          footer={
            <>
              <button type="button">Cancel</button>
              <button type="button" ref={okRef}>
                OK
              </button>
            </>
          }
        >
          <input aria-label="Amount" />
        </Modal>
      );
    }
    const { unmount } = render(<Demo />);
    const close = screen.getByRole('button', { name: 'Close' });
    const ok = screen.getByRole('button', { name: 'OK' });
    expect(document.activeElement).toBe(ok);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ok);
    // Focus that escapes is pulled back into the dialog.
    act(() => outside.focus());
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('Toast auto-dismisses unless critical', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast title="Map cleared in 27 steps" tone="good" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const onCrit = vi.fn();
    render(<Toast title="Agent lost to lava" tone="critical" onClose={onCrit} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60000));
    expect(onCrit).not.toHaveBeenCalled();
  });
});

describe('public surface', () => {
  it('keeps everything the web app imports', () => {
    const used = [
      'AgentAvatar',
      'AkIcon',
      'Badge',
      'Button',
      'CreditsBalance',
      'DisplayHeading',
      'HazardTape',
      'Icon',
      'Kicker',
      'Logo',
      'Meter',
      'Modal',
      'Pips',
      'Segmented',
      'Soon',
      'Tabs',
      'TagChip',
      'TextField',
      'Toast',
      'TopUpPanel',
      'UnlockChip',
      'cx',
      'fmt',
      'unlockName',
    ];
    expect(used.filter((name) => !(name in ui))).toEqual([]);
  });
});

describe('rest props pass through', () => {
  it('Badge, TagChip and Tabs forward className, data-testid and aria-*', () => {
    render(
      <>
        <Badge tone="good" className="x-badge" data-testid="b1" aria-label="cleared">
          Cleared
        </Badge>
        <TagChip tag="liquid" className="x-chip" data-testid="c1" aria-describedby="d" />
        <Tabs
          tabs={[
            { id: 'a', label: 'A', testId: 'tab-a' },
            { id: 'b', label: 'B' },
          ]}
          className="x-tabs"
          data-testid="t1"
          aria-label="Pick"
        />
      </>,
    );
    const b = screen.getByTestId('b1');
    expect(b.className).toContain('sk-badge');
    expect(b.className).toContain('x-badge');
    expect(b.getAttribute('aria-label')).toBe('cleared');
    const c = screen.getByTestId('c1');
    expect(c.className).toContain('x-chip');
    expect(c.getAttribute('aria-describedby')).toBe('d');
    const t = screen.getByTestId('t1');
    expect(t.getAttribute('role')).toBe('tablist');
    expect(t.className).toContain('x-tabs');
    expect(screen.getByRole('tablist', { name: 'Pick' })).toBe(t);
    expect(screen.getByTestId('tab-a').getAttribute('role')).toBe('tab');
  });
});

describe('copy rules (UI/UX: say "step", not "turn" or "tick")', () => {
  it('TopUpPanel says step', () => {
    const { container } = render(<TopUpPanel network="Testnet" />);
    expect(container.textContent).toContain('1 credit pays for one agent step.');
    expect(container.textContent).not.toMatch(/\bturns?\b/i);
  });
});
