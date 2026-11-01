import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMe, useMyMatches } from '@/lib/api/queries';
import { meFixture, myMatchFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

function Probe() {
  const me = useMe();
  const matches = useMyMatches();
  return (
    <p data-testid="probe">
      {me.data?.credits.available ?? '-'}|{matches.data?.length ?? '-'}
    </p>
  );
}

describe('RealtimeInvalidation', () => {
  it('refreshes the account and its recent matches when a v2 match ends, and nothing on other messages', async () => {
    let available = 60;
    const { api, realtime } = renderWithProviders(<Probe />, {
      handle: 'ada',
      api: {
        me: async () => meFixture({ credits: { ...meFixture().credits, available } }),
        myMatches: async () => [myMatchFixture()],
      },
    });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('60|1'));
    expect(api.me).toHaveBeenCalledTimes(1);

    act(() => realtime.emit({ type: 'queue_status', searchingMs: 0, eloRange: 50 }));
    expect(api.me).toHaveBeenCalledTimes(1);

    available = 36;
    act(() => realtime.emit({ type: 'v2_end', matchId: 'mat_v2', result: null, reason: 'goal', logHash: null }));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('36|1'));
    expect(api.myMatches).toHaveBeenCalledTimes(2);
  });
});
