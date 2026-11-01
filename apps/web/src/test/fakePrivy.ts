// Fake Privy client for session tests (privy mode without the SDK).
//
//   const privy = new FakePrivy({ ready: true, authenticated: false, token: 'jwt_1' });
//   renderWithProviders(<SignInScreen />, { authMode: 'privy', privy });
//   act(() => privy.setState({ ready: true, authenticated: true }));   // Privy restored a session
import { vi } from 'vitest';
import type { PrivyClient, PrivyLoginMethod, PrivyState } from '@/lib/auth/privy';

export class FakePrivy implements PrivyClient {
  state: PrivyState;
  /** What getAccessToken() and login() hand out. */
  token: string | null;
  private readonly subs = new Set<() => void>();

  constructor(opts: Partial<PrivyState> & { token?: string | null } = {}) {
    this.state = { ready: opts.ready ?? true, authenticated: opts.authenticated ?? false };
    this.token = opts.token === undefined ? 'privy_token_1' : opts.token;
  }

  setState(s: PrivyState): void {
    this.state = s;
    for (const fn of [...this.subs]) fn();
  }

  getState = () => this.state;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  login = vi.fn(async (_method: PrivyLoginMethod) => {
    this.setState({ ready: true, authenticated: true });
    if (!this.token) throw new Error('no token');
    return this.token;
  });

  getAccessToken = vi.fn(async () => (this.state.authenticated ? this.token : null));

  logout = vi.fn(async () => {
    this.setState({ ready: true, authenticated: false });
  });
}
