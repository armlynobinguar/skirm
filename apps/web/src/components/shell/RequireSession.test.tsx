import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { RequireSession } from './RequireSession';

describe('RequireSession', () => {
  it('asks signed-out visitors to sign in and comes back afterwards', async () => {
    renderWithProviders(<RequireSession>secret</RequireSession>, { path: '/skills' });
    const box = await screen.findByTestId('signin-required');
    expect(box.querySelector('a')).toHaveAttribute('href', '/?next=%2Fskills');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it("says what the screen is for, links the public screens and plays the showreel", async () => {
    renderWithProviders(<RequireSession>secret</RequireSession>, { path: '/skills' });
    expect(await screen.findByTestId('signin-pitch')).toHaveTextContent('only you ever see its text');
    const links = screen.getByTestId('signin-public');
    expect(links.querySelector('a[href="/leaderboards"]')).not.toBeNull();
    expect(links.querySelector('a[href="/market"]')).not.toBeNull();
    expect(links.querySelector('a[href="/verify"]')).not.toBeNull();
    expect(screen.getByTestId('s02-showreel')).toBeInTheDocument();
  });

  it('keeps the plain prompt on a screen without a pitch', async () => {
    renderWithProviders(<RequireSession>secret</RequireSession>, { path: '/account' });
    await screen.findByTestId('signin-required');
    expect(screen.queryByTestId('signin-pitch')).not.toBeInTheDocument();
  });

  it('renders children when signed in', async () => {
    renderWithProviders(<RequireSession>secret</RequireSession>, { handle: 'ada' });
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });
});
