import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AkIcon, DiamondChip, DisplayHeading, HazardTape, Kicker, Panel, Pips, Segmented, Soon, akIconMarkup, type AkIconName } from '../src';

afterEach(cleanup);

describe('Arena primitives', () => {
  it('Panel renders the chosen element with its side colour and passes props through', () => {
    render(
      <Panel as="section" side="rival" flush data-testid="p" aria-label="Rival crew">
        <Kicker>
          <b>You</b> · Elo
        </Kicker>
      </Panel>,
    );
    const p = screen.getByTestId('p');
    expect(p.tagName).toBe('SECTION');
    expect(p.className).toBe('sk-panel is-rival is-flush');
    expect(p.getAttribute('aria-label')).toBe('Rival crew');
    expect(p.querySelector('.sk-kick b')?.textContent).toBe('You');
  });

  it('DisplayHeading picks the level and size', () => {
    render(<DisplayHeading level={2} size={60}>Lock in</DisplayHeading>);
    const h = screen.getByRole('heading', { level: 2, name: 'Lock in' });
    expect(h.className).toBe('sk-disp');
    expect(h.style.fontSize).toBe('60px');
  });

  it('HazardTape is decorative', () => {
    const { container } = render(<HazardTape />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('Pips lights value of max, clamped, and reads as "n of max"', () => {
    const { container, rerender } = render(<Pips value={3} max={5} label="Vision" colour="#34e0c8" />);
    expect(screen.getByRole('img', { name: 'Vision 3 of 5' })).toBeTruthy();
    expect(container.querySelectorAll('i').length).toBe(5);
    expect(container.querySelectorAll('i.is-on').length).toBe(3);
    rerender(<Pips value={9} max={5} label="Vision" />);
    expect(container.querySelectorAll('i.is-on').length).toBe(5);
  });

  it('DiamondChip sets its marker colour and selected state', () => {
    render(
      <DiamondChip colour="#ffb547" on data-testid="c">
        Actor · TypeSafe Jev
      </DiamondChip>,
    );
    const c = screen.getByTestId('c');
    expect(c.className).toBe('sk-dchip is-on');
    expect(c.style.getPropertyValue('--sk-dchip-colour')).toBe('#ffb547');
    expect(c.textContent).toBe('Actor · TypeSafe Jev');
  });

  it('Segmented marks the value pressed and reports other picks only', () => {
    const onChange = vi.fn();
    const opts = [
      { value: 'quiet', label: 'Quiet' },
      { value: 'standard', label: 'Standard' },
      { value: 'open', label: 'Open', disabled: true },
    ] as const;
    render(<Segmented label="Talk tier" value="standard" options={[...opts]} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Talk tier' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Quiet' }));
    expect(onChange).toHaveBeenCalledWith('quiet');
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Segmented locks every option when disabled', () => {
    render(<Segmented label="Talk tier" value="standard" disabled options={[{ value: 'standard', label: 'Standard' }, { value: 'open', label: 'Open' }]} />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('Soon labels a feature that is not live yet, never a value', () => {
    const { rerender } = render(<Soon what="Season prizes" data-testid="s" />);
    const s = screen.getByTestId('s');
    expect(s.className).toBe('sk-soon');
    expect(s.textContent).toBe('Soon');
    expect(s.getAttribute('aria-label')).toBe('Season prizes: coming soon');
    expect(s.hasAttribute('data-soon')).toBe(true);
    rerender(<Soon data-testid="s">Soon · season 2</Soon>);
    expect(screen.getByTestId('s').getAttribute('title')).toBe('Coming soon');
    expect(screen.getByTestId('s').textContent).toBe('Soon · season 2');
  });
});

describe('AkIcon', () => {
  const NAMES: AkIconName[] = ['play', 'mine', 'market', 'skirm', 'pvp', 'lb', 'sfx', 'notes', 'atlas', 'crew', 'proof', 'practice', 'pause', 'resume', 'tpv', 'story', 'back'];

  it('draws every icon with brackets, dots and an accent, and only references its own clip paths', () => {
    for (const name of NAMES) {
      const svg = akIconMarkup(name, 'x');
      expect(svg, name).toContain('<defs>');
      expect(svg, name).toMatch(/var\(--nacc,var\(--you\)\)|var\(--rival\)/);
      for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(svg, `${name} ${ref}`).toContain(`id="${ref}"`);
    }
  });

  it('keeps clip-path ids unique across instances and hides the icon from assistive tech', () => {
    const { container } = render(
      <>
        <AkIcon name="play" />
        <AkIcon name="play" />
      </>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    expect(svgs[0]!.getAttribute('aria-hidden')).toBe('true');
    const ids = Array.from(container.querySelectorAll('clipPath'), (c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
