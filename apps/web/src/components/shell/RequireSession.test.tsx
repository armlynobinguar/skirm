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

  it('renders children when signed in', async () => {
    renderWithProviders(<RequireSession>secret</RequireSession>, { handle: 'ada' });
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });
});
