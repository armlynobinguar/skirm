import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SKILL_DRAFT_PREFIX, clearPrivateDrafts } from './drafts';
import { useSession } from './session';

function SignOutButton() {
  const s = useSession();
  return (
    <button type="button" onClick={() => void s.signOut()}>
      out {s.status}
    </button>
  );
}

afterEach(() => localStorage.clear());

describe('secret prompt drafts', () => {
  it('clearPrivateDrafts removes only skirm.skillEditor.unsaved.* keys', () => {
    localStorage.setItem(`${SKILL_DRAFT_PREFIX}skl_1`, 'secret');
    localStorage.setItem(`${SKILL_DRAFT_PREFIX}new`, 'secret 2');
    localStorage.setItem('skirm.prefs.v1', '{}');
    expect(clearPrivateDrafts()).toBe(2);
    expect(localStorage.getItem(`${SKILL_DRAFT_PREFIX}skl_1`)).toBeNull();
    expect(localStorage.getItem('skirm.prefs.v1')).toBe('{}');
    expect(clearPrivateDrafts(null)).toBe(0);
  });

  it('sign-out removes them', async () => {
    localStorage.setItem(`${SKILL_DRAFT_PREFIX}skl_1`, 'secret');
    const { user } = renderWithProviders(<SignOutButton />, { handle: 'ada' });
    await user.click(await screen.findByRole('button', { name: 'out signedIn' }));
    await waitFor(() => expect(localStorage.getItem(`${SKILL_DRAFT_PREFIX}skl_1`)).toBeNull());
    expect(screen.getByRole('button').textContent).toBe('out signedOut');
  });
});
