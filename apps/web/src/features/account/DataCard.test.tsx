import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { DataCard } from './DataCard';

afterEach(() => vi.restoreAllMocks());

describe('S16 your data', () => {
  it('downloads the export as a JSON file', async () => {
    const url = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { api, user } = renderWithProviders(<DataCard handle="ada" />, { handle: 'ada', api: { exportMe: async () => ({ accountId: 'acc_1' }) } });
    await user.click(screen.getByTestId('s16-export'));
    expect(api.exportMe).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(url).toHaveBeenCalledTimes(1);
  });

  it('deletes only once the handle is typed, then signs out to the sign-in screen', async () => {
    const { api, user, router } = renderWithProviders(<DataCard handle="ada" />, { handle: 'ada', api: { deleteMe: async () => ({ deleted: true as const }) } });
    await user.click(screen.getByTestId('s16-delete-open'));
    expect(screen.getByTestId('s16-delete')).toHaveTextContent('This cannot be undone.');
    expect(screen.getByTestId('s16-delete-go')).toBeDisabled();
    await user.type(screen.getByLabelText('Your handle'), 'ad');
    expect(screen.getByTestId('s16-delete-go')).toBeDisabled();
    await user.type(screen.getByLabelText('Your handle'), 'a');
    await user.click(screen.getByTestId('s16-delete-go'));
    expect(api.deleteMe).toHaveBeenCalledWith('ada');
    expect(router.push).toHaveBeenCalledWith('/');
  });
});
