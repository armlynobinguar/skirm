import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';
import { routes } from '@/lib/routes';
import { PrivacyDoc, TermsDoc } from './LegalDoc';

describe('terms and privacy', () => {
  it('states the rules: testnet, credits, fees, rentals, final transactions, and links the privacy policy', () => {
    render(<TermsDoc />);
    const doc = screen.getByTestId('legal-terms');
    expect(within(doc).getByTestId('legal-draft')).toHaveTextContent(/testnet/i);
    expect(doc).toHaveTextContent('5% platform fee');
    expect(doc).toHaveTextContent(/Renting another player/);
    expect(doc).toHaveTextContent(/cannot reverse a purchase or a rental on chain/);
    expect(within(doc).getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', routes.privacy());
  });

  it('says what is stored, who sees it, and how to export or delete it', () => {
    render(<PrivacyDoc />);
    const doc = screen.getByTestId('legal-privacy');
    expect(doc).toHaveTextContent(/encrypted at rest/);
    expect(doc).toHaveTextContent(/AI model provider/);
    expect(doc).toHaveTextContent(/public and permanent/);
    expect(doc).toHaveTextContent(/Export:/);
    expect(doc).toHaveTextContent(/Delete:/);
    expect(within(doc).getByRole('link', { name: 'terms' })).toHaveAttribute('href', routes.terms());
  });

  it('are in the sitemap', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/terms'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/privacy'))).toBe(true);
    // Sign-in-only screens stay out: a crawler would only see the sign-in prompt.
    expect(urls.some((u) => u.endsWith('/play') || u.endsWith('/puzzles'))).toBe(false);
  });
});
