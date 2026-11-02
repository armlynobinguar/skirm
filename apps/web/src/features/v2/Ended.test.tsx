import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import { ApiError } from '@/lib/api/errors';
import { FakeRealtime } from '@/test/fakeRealtime';
import { v2DebriefFixture, v2FrameFixture, v2MatchRecordFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2ResultScreen } from './Ended';

afterEach(() => arenaStore().setLive(null));

const soonCount = () => document.querySelectorAll('[data-soon]').length;

describe('v2 result screen', () => {
  it('shows the bluffs told and landed, and the rival bluffs seen through', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      api: { v2Match: async () => v2MatchRecordFixture({ debrief: v2DebriefFixture({ bluffs: { told: 3, believed: 1, heard: 2, seenThrough: 2 } }) }) },
    });
    await screen.findByTestId('v2-verdict');
    const tally = screen.getByTestId('v2-tally');
    expect(tally).toHaveTextContent('Bluffs told · believed by the rival3 · 1');
    expect(tally).toHaveTextContent('Rival bluffs · your agents saw through2 · 2');
    // Only season points are still "Soon".
    expect(within(tally).getAllByText('Soon')).toHaveLength(1);
  });

  it('lays out the debrief from the stored record: verdict, stars, Elo, MVP, report, registry and hash', async () => {
    const { api } = renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      // Ranked, 2 Standard agents: 60 held for 150 ticks, ceil(90 × 0.40) = 36 used.
      api: { v2Match: async () => v2MatchRecordFixture({ debrief: v2DebriefFixture({ credits: { held: 60, used: 36, returned: 24 } }) }) },
    });
    expect(await screen.findByTestId('v2-verdict')).toHaveTextContent('Victory');
    expect(api.v2Match).toHaveBeenCalledWith('mat_v2');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('CH-05 · Copper Hollow · Normal · ranked · 3:00 played');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('4 – 2 after 90 ticks, reached the goal (first to the goal). Rival: ben.');
    const stars = within(screen.getByTestId('v2-stars')).getAllByRole('listitem');
    expect(stars.map((s) => s.textContent)).toEqual(['Goal · Shore the tunnels · earned', 'Won the match · earned']);
    expect(screen.getByTestId('v2-elo')).toHaveTextContent('+16');
    expect(screen.getByTestId('v2-mvp')).toHaveTextContent('Wick');
    const tally = screen.getByTestId('v2-tally');
    expect(tally).toHaveTextContent('Normal goal · Shore the tunnelsComplete · 3/3 verbs');
    expect(tally).toHaveTextContent('Messages sent12');
    expect(tally).toHaveTextContent('Rival team chat your agents overheard3');
    expect(tally).toHaveTextContent('Themed verbs used6');
    expect(screen.getByTestId('v2-credits')).toHaveTextContent('36 of 60 held · 24 back');
    // A debrief stored before bluffs were judged has no bluff counts: "Soon" (×2), as are season points.
    expect(soonCount()).toBe(3);
    expect(within(tally).getAllByText('Soon')).toHaveLength(3);
    expect(screen.getByTestId('v2-registry')).toHaveTextContent('Writing result · Elo · replay hash to registry.playskirm.testnet');
    expect(screen.getByTestId('v2-hash')).toHaveTextContent('abab');
    expect(screen.getByTestId('v2-again')).toHaveAttribute('href', '/pvp');
    expect(screen.getByTestId('v2-replay')).toHaveAttribute('href', '/matches/mat_v2#replay');
  });

  it('sends a casual match back to its crew screen, with no Elo and no registry write', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      api: {
        v2Match: async () =>
          v2MatchRecordFixture({
            ranked: false,
            difficulty: 'hard',
            winner: 'B',
            score: { A: 1, B: 4 },
            elo: [],
            registry: { status: 'none' },
            debrief: v2DebriefFixture({ eloDelta: null, registry: null, goals: [{ title: 'Ears on the pier', met: false, available: false, progress: null }] }),
          }),
      },
    });
    expect(await screen.findByTestId('v2-verdict')).toHaveTextContent('Defeat');
    expect(screen.getByTestId('v2-elo')).toHaveTextContent('—');
    expect(screen.getByTestId('v2-again')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=hard');
    expect(screen.getByTestId('v2-registry')).toHaveTextContent('Casual match · not written to the registry');
    // A goal the engine cannot judge yet (bluffs) is "Soon" on its star and its report row.
    expect(within(screen.getByTestId('v2-stars')).getByText('Soon')).toBeInTheDocument();
    expect(soonCount()).toBe(5);
  });

  it('gives a spectator the result by crew handle, with no verdict, stars or report of their own', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      api: { v2Match: async () => v2MatchRecordFixture({ winner: 'B', score: { A: 2, B: 4 }, you: undefined, debrief: undefined }) },
    });
    expect(await screen.findByTestId('v2-verdict')).toHaveTextContent('ben wins');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('ada vs ben.');
    expect(screen.queryByTestId('v2-stars')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-tally')).toHaveTextContent('Each crew’s report goes to its own player.');
    expect(screen.getByTestId('v2-again')).toHaveTextContent('Back to the hub');
    // A record alone has no transcript (the tab did not see the talk).
    expect(screen.queryByTestId('v2-transcript')).not.toBeInTheDocument();
  });

  it('shows the written registry line with its transaction', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      api: { v2Match: async () => v2MatchRecordFixture({ registry: { status: 'recorded', txHash: 'Fx9' } }) },
    });
    expect(await screen.findByTestId('v2-registry')).toHaveTextContent('✓ Result · Elo · replay hash → registry.playskirm.testnet · tx Fx9');
  });

  it("uses this tab's debrief and last frame when the record is not there yet", async () => {
    const rt = new FakeRealtime();
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, { realtime: rt, api: { v2Match: async () => Promise.reject(new ApiError(404, 'not_found', 'No match')) } });
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_v2', team: 'A', mapId: 'copper-hollow', ranked: true, acceptMs: 10_000 });
      rt.emit({ type: 'v2_frame', matchId: 'mat_v2', frame: v2FrameFixture({ tick: 90 }) });
      rt.emit({
        type: 'v2_end',
        matchId: 'mat_v2',
        result: { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 2 }, ticks: 90 },
        reason: 'goal',
        logHash: 'cd'.repeat(32),
        debrief: v2DebriefFixture(),
      });
    });
    expect(await screen.findByTestId('v2-verdict')).toHaveTextContent('Victory');
    expect(screen.getByTestId('v2-elo')).toHaveTextContent('+16');
    expect(screen.getByTestId('v2-hash')).toHaveTextContent('cdcd');
    expect(arenaStore().get().live?.arena.tick).toBe(90);
  });

  it('says a match is still running, and shows a void', async () => {
    const { unmount } = renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      api: { v2Match: async () => v2MatchRecordFixture({ status: 'live', winner: null, score: null, debrief: null }) },
    });
    expect(await screen.findByTestId('v2-result-live')).toHaveTextContent('This match is still running');
    unmount();
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      api: { v2Match: async () => v2MatchRecordFixture({ status: 'void', winner: null, score: null, reason: 'accept_timeout', debrief: null }) },
    });
    expect(await screen.findByTestId('v2-verdict')).toHaveTextContent('Void');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('A player did not accept in time');
  });

  it('shows an error card when the match cannot be loaded', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, { api: { v2Match: async () => Promise.reject(new ApiError(404, 'not_found', 'No match')) } });
    expect(await screen.findByTestId('error-card')).toBeInTheDocument();
  });
});
