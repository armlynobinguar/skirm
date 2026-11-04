import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { FakePrivy } from '@/test/fakePrivy';
import { renderWithProviders } from '@/test/render';
import { SignInScreen } from './SignInScreen';

describe('S01 Sign in', () => {
  it('signs in with a dev handle and goes to Home', async () => {
    const { user, api, credentials, router } = renderWithProviders(<SignInScreen />);
    await user.type(screen.getByLabelText('Handle'), '  Tidecaller ');
    await user.click(screen.getByTestId('s01-signin'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/play'));
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(credentials.get()).toEqual({ kind: 'dev', handle: 'tidecaller' });
  });

  it('links the terms and the privacy policy', async () => {
    renderWithProviders(<SignInScreen />, { path: '/' });
    const legal = await screen.findByTestId('s01-legal');
    expect(within(legal).getByRole('link', { name: 'terms' })).toHaveAttribute('href', '/terms');
    expect(within(legal).getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
  });

  it('follows ?next= after sign-in', async () => {
    const { user, router } = renderWithProviders(<SignInScreen />);
    window.history.replaceState(null, '', '/?next=%2Fmarket');
    await user.type(screen.getByLabelText('Handle'), 'ada');
    await user.click(screen.getByTestId('s01-signin'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/market'));
    window.history.replaceState(null, '', '/');
  });

  it('keeps the visitor signed out and explains when sign-in fails', async () => {
    const { user, credentials } = renderWithProviders(<SignInScreen />, {
      api: { createSession: async () => Promise.reject(new ApiError(0, 'network', 'Failed to fetch')) },
    });
    await user.type(screen.getByLabelText('Handle'), 'ada');
    await user.click(screen.getByTestId('s01-signin'));
    expect(await screen.findByTestId('s01-error')).toHaveTextContent("Sign-in didn't finish. Try again or use another option.");
    expect(credentials.get()).toBeNull();
    expect(screen.getByTestId('s01-signin')).not.toBeDisabled();
  });

  it('refuses a handle the server would refuse, without calling it', async () => {
    const { user, api } = renderWithProviders(<SignInScreen />);
    await user.type(screen.getByLabelText('Handle'), 'a b');
    await user.click(screen.getByTestId('s01-signin'));
    expect(await screen.findByTestId('s01-error')).toHaveTextContent('2 to 32 characters');
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('sends signed-in visitors on to Home', async () => {
    const { router } = renderWithProviders(<SignInScreen />, { handle: 'ada' });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/play'));
  });

  it('pitches v2 practice and the free allowance, with no tutorial or replay', () => {
    renderWithProviders(<SignInScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your crew plays the match. You write how.');
    expect(screen.getByTestId('s01-practice')).toHaveTextContent('Play a practice match against a bot crew: free, no keys needed');
    expect(screen.getByTestId('s01-practice')).toHaveTextContent('Greedy bot');
    expect(screen.getByTestId('screen-s01')).toHaveTextContent('60 free credits a day');
    expect(screen.getByTestId('screen-s01')).not.toHaveTextContent(/tutorial|Flood Gate|replay/i);
    expect(screen.getByTestId('s01-ladder')).toHaveAttribute('href', '/leaderboards');
  });

  it('reads the handle from the field on submit (text typed before hydration counts)', async () => {
    const { user, credentials, router } = renderWithProviders(<SignInScreen />);
    // Uncontrolled: a value already in the DOM (typed before React attached) is what gets sent.
    const field = screen.getByLabelText('Handle') as HTMLInputElement;
    field.value = 'early-bird';
    expect(screen.getByTestId('s01-signin')).not.toBeDisabled();
    await user.click(screen.getByTestId('s01-signin'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/play'));
    expect(credentials.get()).toEqual({ kind: 'dev', handle: 'early-bird' });
  });

  it('asks for a handle instead of disabling Sign in', async () => {
    const { user, api } = renderWithProviders(<SignInScreen />);
    await user.click(screen.getByTestId('s01-signin'));
    expect(await screen.findByTestId('s01-error')).toHaveTextContent('Enter a handle to sign in.');
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('signs in a handle submitted before hydration (?handle=) and drops it from the URL', async () => {
    window.history.replaceState(null, '', '/?handle=Judge1');
    const { credentials, router } = renderWithProviders(<SignInScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/play'));
    expect(credentials.get()).toEqual({ kind: 'dev', handle: 'judge1' });
    expect(window.location.search).toBe('');
  });

  it('privy mode: Google and email buttons sign in through Privy with the access token', async () => {
    const privy = new FakePrivy({ ready: true, authenticated: false, token: 'jwt_g' });
    const { user, api, credentials, router } = renderWithProviders(<SignInScreen />, { authMode: 'privy', privy });
    expect(screen.queryByLabelText('Handle')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('s01-google'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/play'));
    expect(privy.login).toHaveBeenCalledWith('google');
    expect(api.createSession).toHaveBeenCalledWith({ token: 'jwt_g' });
    expect(credentials.get()).toEqual({ kind: 'privy', token: 'jwt_g' });
  });

  it('privy mode: a refused token ends the Privy session and shows the failure', async () => {
    const privy = new FakePrivy({ ready: true });
    const { user, credentials } = renderWithProviders(<SignInScreen />, {
      authMode: 'privy',
      privy,
      api: { createSession: async () => Promise.reject(new ApiError(401, 'unauthenticated', 'invalid privy token')) },
    });
    await user.click(await screen.findByTestId('s01-email'));
    expect(await screen.findByTestId('s01-error')).toHaveTextContent("Sign-in didn't finish");
    expect(privy.login).toHaveBeenCalledWith('email');
    expect(privy.logout).toHaveBeenCalled();
    expect(credentials.get()).toBeNull();
  });
});
