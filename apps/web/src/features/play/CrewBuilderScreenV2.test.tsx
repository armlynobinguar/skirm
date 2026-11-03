import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import { MAPS } from '@/features/arena/world';
import { v2StoreFor } from '@/features/v2/v2Store';
import { agentFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders, type RenderOptions } from '@/test/render';
import { V2CrewScreen } from './CrewBuilderScreenV2';

const WICK = agentFixture({ id: 'agt_wick', name: 'Wick', role: 'Builder', vision: 4, comms: 3, tier: 'standard' });
const MOSS = agentFixture({ id: 'agt_moss', name: 'Moss', role: 'Runner', tier: 'open' });
const ROOK = agentFixture({ id: 'agt_rook', name: 'Rook', role: 'Scout', tier: 'quiet' });
const PIKE = agentFixture({ id: 'agt_pike', name: 'Pike', role: 'Digger' });

const me = (o: Parameters<typeof meFixture>[0] = {}) =>
  meFixture({ agents: [WICK, MOSS, ROOK, PIKE], credits: { balance: 5000, held: 0, allowanceLeft: 0, allowanceResetAt: '2026-11-01T00:00:00.000Z', available: 5000 }, ...o });

function setup(search = '', api: RenderOptions['api'] = {}) {
  const d = new URLSearchParams(search).get('d') ?? undefined;
  return renderWithProviders(<V2CrewScreen mapId="copper-hollow" difficulty={d} />, {
    handle: 'ada',
    path: '/maps/copper-hollow/crew',
    search,
    api: { me: async () => me(), skills: async () => [], ...api },
  });
}

afterEach(() => arenaStore().setMap(0));

describe('S04 v2 crew screen', () => {
  const PASS = {
    rentalId: 'rnt_1',
    offerId: 'rof_1',
    agentId: 'agt_hired',
    agent: { name: 'Juno', role: 'Scout', vision: 4, comms: 5, tier: 'open', ownerHandle: 'kai' },
    priceYocto: '1000',
    matchId: null,
    createdAt: '2026-11-03T00:00:00.000Z',
  };

  it('fields a rented agent from its pass in the queued crew, with no edit link', async () => {
    const { realtime, user } = setup('', { myRentals: async () => ({ offers: [], passes: [PASS, { ...PASS, rentalId: 'rnt_2' }] }), rentalOffers: async () => [] });
    const hired = await screen.findByTestId('s04-rented-agt_hired');
    // Two passes for one agent: one pick, "2 left".
    expect(hired).toHaveTextContent('Juno');
    expect(hired).toHaveTextContent('2 left');
    await user.click(hired);
    expect(screen.getByTestId('s04-card-agt_hired')).toBeInTheDocument();
    expect(within(screen.getByTestId('s04-card-agt_hired')).queryByRole('link', { name: /edit/i })).toBeNull();
    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')[0]!.crew.map((c: { agentId: string }) => c.agentId)).toContain('agt_hired');
  });

  it('rents an offered agent in dev mode and refreshes the passes', async () => {
    const offer = { offerId: 'rof_9', agentId: 'agt_x', name: 'Rook II', role: 'Builder', vision: 3, comms: 3, tier: 'standard', ownerId: 'acc_k', ownerHandle: 'kai', ownerNearAccountId: 'kai.testnet', priceYocto: '500000000000000000000000' };
    let passes: (typeof PASS)[] = [];
    const { api, user } = setup('', {
      myRentals: async () => ({ offers: [], passes }),
      rentalOffers: async () => [offer],
      rent: async (offerId: string) => {
        passes = [{ ...PASS, offerId, agentId: 'agt_x', agent: { ...PASS.agent, name: 'Rook II' } }];
        return { pass: passes[0]! };
      },
    });
    const btn = await screen.findByTestId('s04-rent-rof_9');
    expect(btn).toHaveTextContent('Rent · 0.5 NEAR');
    await user.click(btn);
    expect(api.rent).toHaveBeenCalledWith('rof_9', expect.stringMatching(/^dev:500000000000000000000000:/));
    expect(await screen.findByTestId('s04-rented-agt_x')).toHaveTextContent('Rook II');
  });

  it('builds a casual crew at the difficulty from the URL and queues it on this map', async () => {
    const { user, realtime, router } = setup('?d=hard');
    const card = await screen.findByTestId(`s04-card-${WICK.id}`);
    expect(screen.getByTestId('screen-s04')).toHaveTextContent('Build your crew');
    expect(card).toHaveTextContent('Builder');
    expect(within(card).getByRole('link', { name: 'Open the agent editor for Wick' })).toHaveAttribute('href', '/agents/agt_wick?map=copper-hollow&d=hard');
    expect(screen.getByTestId('diff-hard')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('goal-box')).toHaveTextContent('Hard · goal on Copper Hollow');
    expect(MAPS[arenaStore().get().mapIdx]!.id).toBe('copper-hollow');
    // Hard: 135 ticks × 0.20 credits per tick = 27.
    expect(screen.getByTestId('s04-estimate')).toHaveTextContent('27');
    expect(screen.getByTestId('s04-estimate')).toHaveTextContent('135 ticks × (0.20) credits per tick');

    // + Moss on Open: ceil(135 × 0.60) = 81; on Quiet: 135 × 0.40 = 54.
    await user.click(screen.getByTestId(`s04-roster-${MOSS.id}`));
    expect(screen.getByTestId('s04-estimate')).toHaveTextContent('81');
    expect(screen.getByTestId('s04-estimate')).toHaveTextContent('135 ticks × (0.20 + 0.40) credits per tick');
    await user.click(within(screen.getByTestId(`s04-card-${MOSS.id}`)).getByRole('radio', { name: 'Quiet' }));
    expect(screen.getByTestId('s04-estimate')).toHaveTextContent('54');

    await user.click(screen.getByTestId('diff-easy'));
    expect(router.replace).toHaveBeenCalledWith('/maps/copper-hollow/crew?d=easy', { scroll: false });

    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')).toEqual([
      {
        type: 'v2_queue',
        ranked: false,
        mapId: 'copper-hollow',
        difficulty: 'easy',
        crew: [
          { agentId: WICK.id, tier: 'standard' },
          { agentId: MOSS.id, tier: 'quiet' },
        ],
      },
    ]);
    expect(v2StoreFor(realtime).queued).toEqual([
      { agentId: WICK.id, name: 'Wick', tier: 'standard' },
      { agentId: MOSS.id, name: 'Moss', tier: 'quiet' },
    ]);
    act(() => realtime.emit({ type: 'queue_status', searchingMs: 4000, eloRange: 100 }));
    expect(screen.getByTestId('s04-searching')).toHaveTextContent('Searching Easy on Copper Hollow · 0:04');
    expect(screen.getByTestId(`s04-roster-${ROOK.id}`)).toBeDisabled();

    act(() => realtime.emit({ type: 'v2_found', matchId: 'mat_9', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, difficulty: 'easy' }));
    expect(router.push).toHaveBeenCalledWith('/matches/mat_9');
  });

  it('ranked locks Normal and Standard and queues the ladder without a map', async () => {
    const { user, realtime } = setup('?d=mega');
    await screen.findByTestId(`s04-card-${WICK.id}`);
    await user.click(screen.getByTestId(`s04-roster-${MOSS.id}`));
    await user.click(within(screen.getByTestId('s04-mode')).getByRole('button', { name: 'Ranked' }));
    expect(screen.getByTestId('screen-s04')).toHaveTextContent('Lock in your crew');
    expect(screen.getByTestId('diff-normal')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('diff-mega')).toBeDisabled();
    expect(within(screen.getByTestId(`s04-card-${MOSS.id}`)).getByRole('radio', { name: 'Standard' })).toBeChecked();
    expect(screen.getByTestId('goal-box')).toHaveTextContent('Ranked always plays Normal');
    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')).toEqual([
      {
        type: 'v2_queue',
        ranked: true,
        crew: [
          { agentId: WICK.id, tier: 'standard' },
          { agentId: MOSS.id, tier: 'standard' },
        ],
      },
    ]);
  });

  it('caps the crew at three, keeps one, and cancels a search', async () => {
    const { user, realtime } = setup();
    await screen.findByTestId(`s04-card-${WICK.id}`);
    for (const a of [MOSS, ROOK, PIKE]) await user.click(screen.getByTestId(`s04-roster-${a.id}`));
    expect(screen.queryByTestId(`s04-card-${PIKE.id}`)).not.toBeInTheDocument();
    expect(await screen.findByText('Three agents is the most a crew can field.')).toBeInTheDocument();
    for (const a of [MOSS, ROOK]) await user.click(screen.getByRole('button', { name: `Remove ${a.name}` }));
    await user.click(screen.getByRole('button', { name: 'Remove Wick' }));
    expect(screen.getByTestId(`s04-card-${WICK.id}`)).toBeInTheDocument();

    await user.click(screen.getByTestId('s04-queue'));
    await user.click(screen.getByTestId('s04-cancel'));
    expect(realtime.sentOf('v2_cancel_queue')).toHaveLength(1);
    expect(screen.getByTestId('s04-queue')).toBeEnabled();
  });

  it('blocks a crew the credits cannot hold', async () => {
    const { realtime, user } = renderWithProviders(<V2CrewScreen mapId="copper-hollow" />, {
      handle: 'ada',
      api: { me: async () => meFixture({ agents: [WICK, MOSS] }), skills: async () => [] },
    });
    await screen.findByTestId(`s04-card-${WICK.id}`);
    // 60 credits available: one Standard agent holds 30, adding Moss on Open makes it 90.
    expect(screen.queryByTestId('s04-short')).not.toBeInTheDocument();
    expect(screen.getByTestId('s04-queue')).toBeEnabled();
    await user.click(screen.getByTestId(`s04-roster-${MOSS.id}`));
    expect(screen.getByTestId('s04-short')).toHaveTextContent('This crew holds 90 credits; you have 60.');
    expect(screen.getByTestId('s04-queue')).toBeDisabled();
    expect(realtime.sentOf('v2_queue')).toEqual([]);
  });

  it('says so when a queue is refused', async () => {
    const { user, realtime } = setup();
    await screen.findByTestId(`s04-card-${WICK.id}`);
    await user.click(screen.getByTestId('s04-queue'));
    act(() => realtime.emit({ type: 'error', code: 'agent_busy', message: 'busy' }));
    expect(screen.getByTestId('s04-queue-error')).toHaveTextContent('An agent is busy');
    expect(screen.getByTestId('s04-queue')).toBeEnabled();
  });
  it('Practice opens with Vs Greedy bot on and starts a practice on this map at once', async () => {
    const { user, realtime, router } = setup('?d=easy&opponent=bot');
    await screen.findByTestId(`s04-card-${WICK.id}`);
    expect(within(screen.getByTestId('s04-opponent')).getByRole('radio', { name: 'Vs Greedy bot' })).toBeChecked();
    expect(screen.getByTestId('s04-opponent-note')).toHaveTextContent('Starts at once against a bot crew. Free when the server has no model key.');
    expect(screen.getByTestId('s04-map-line')).toHaveTextContent('practice vs Greedy bot');
    // Copper Hollow is one of PRACTICE_MAPS.
    expect(screen.getByTestId('s04-quick')).toHaveTextContent('quick');

    // Another difficulty keeps the bot in the URL.
    await user.click(screen.getByTestId('diff-normal'));
    expect(router.replace).toHaveBeenCalledWith('/maps/copper-hollow/crew?d=normal&opponent=bot', { scroll: false });

    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')).toEqual([
      { type: 'v2_queue', ranked: false, mapId: 'copper-hollow', difficulty: 'normal', opponent: 'bot', crew: [{ agentId: WICK.id, tier: 'standard' }] },
    ]);
    expect(screen.getByTestId('s04-searching')).toHaveTextContent('Starting practice vs Greedy bot');
    act(() =>
      realtime.emit({ type: 'v2_found', matchId: 'mat_bot', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, practice: true, free: true, rivalHandle: 'Greedy bot' }),
    );
    expect(router.push).toHaveBeenCalledWith('/matches/mat_bot');
  });

  it('turns the bot off for a matchmade casual, and hides it for ranked', async () => {
    const { user, realtime } = setup('?opponent=bot');
    await screen.findByTestId(`s04-card-${WICK.id}`);
    await user.click(within(screen.getByTestId('s04-opponent')).getByRole('radio', { name: 'Another player' }));
    expect(screen.getByTestId('s04-opponent-note')).toHaveTextContent('Pairs you with another player');
    expect(screen.getByTestId('s04-map-line')).toHaveTextContent('unranked');
    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')[0]).not.toHaveProperty('opponent');
    await user.click(screen.getByTestId('s04-cancel'));

    await user.click(within(screen.getByTestId('s04-mode')).getByRole('button', { name: 'Ranked' }));
    expect(screen.queryByTestId('s04-opponent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s04-quick')).not.toBeInTheDocument();
  });

  it('queues a practice past the hold: the server decides whether it costs anything', async () => {
    const { realtime, user } = renderWithProviders(<V2CrewScreen mapId="copper-hollow" />, {
      handle: 'ada',
      search: '?opponent=bot',
      api: { me: async () => meFixture({ agents: [WICK, MOSS] }), skills: async () => [] },
    });
    await screen.findByTestId(`s04-card-${WICK.id}`);
    await user.click(screen.getByTestId(`s04-roster-${MOSS.id}`));
    // 60 available, 90 held: a matchmade casual is blocked, a practice is not.
    expect(screen.getByTestId('s04-short-practice')).toHaveTextContent('This crew would hold 90 credits and you have 60.');
    expect(screen.queryByTestId('s04-short')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('s04-queue'));
    expect(realtime.sentOf('v2_queue')).toHaveLength(1);
    expect(realtime.sentOf('v2_queue')[0]).toMatchObject({ opponent: 'bot' });
  });

  it('marks the largest map quick too: greedy plays every map out cleanly', async () => {
    renderWithProviders(<V2CrewScreen mapId="basalt-stair" />, { handle: 'ada', search: '?opponent=bot', api: { me: async () => me(), skills: async () => [] } });
    await screen.findByTestId(`s04-card-${WICK.id}`);
    expect(screen.getByTestId('s04-map-line')).toHaveTextContent('practice vs Greedy bot');
    expect(screen.getByTestId('s04-quick')).toBeInTheDocument();
  });
});
