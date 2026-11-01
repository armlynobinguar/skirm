import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkillArt, rarityOf, shortHash } from './parts';

describe('rarityOf', () => {
  it('says Starter for an account-bound skill, Draft before mint and Unrated once minted', () => {
    expect(rarityOf({ accountBound: true, status: 'Starter' }).key).toBe('starter');
    expect(rarityOf({ accountBound: false, status: 'Draft' }).key).toBe('draft');
    expect(rarityOf({ accountBound: false, status: 'Listed' })).toMatchObject({ key: 'unrated', band: 'fewer than 5 public runs' });
    expect(rarityOf({ accountBound: false, status: 'Minted' }).key).toBe('unrated');
  });
});

describe('SkillArt', () => {
  it('renders a decorative canvas (jsdom draws nothing)', () => {
    const { container } = render(<SkillArt name="Dam First" tag="liquid" />);
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('shortHash', () => {
  it('prints the first 8 hex digits', () => {
    expect(shortHash('c0ffee12' + 'a'.repeat(56))).toBe('0xc0ffee12');
  });
});
