import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { testRouter } from '@/test/router';
import { MarketplaceScreen, forSaleFirst, mergeMine, v2ProofLine } from './MarketplaceScreen';
import {
  ME_ID,
  SECRET_PROMPT,
  SKILL_ID,
  marketCardFixture,
  marketDetailFixture,
  skillRowFixture,
  skillWithTextFixture,
} from './testFixtures';

afterEach(() => window.history.replaceState(null, '', '/'));

function base(o: Partial<ApiClient> = {}): Partial<ApiClient> {
  return {
    me: async () => meFixture(),
    market: async () => [marketCardFixture()],
    skill: async () => skillWithTextFixture(),
    ...o,
  };
}

describe('S09 Marketplace', () => {
  it('is public: signed-out visitors browse the cards, and My skills asks them to sign in', async () => {
    const { api, user } = renderWithProviders(<MarketplaceScreen />, { api: base() });
    const card = await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(within(card).getByTestId('s09-price')).toHaveTextContent('1.5 NEAR');
    expect(screen.getByTestId('s09-filters')).toBeInTheDocument();
    expect(screen.queryByTestId('signin-required')).not.toBeInTheDocument();
    expect(api.market).toHaveBeenCalledWith({ sort: 'winrate' });
    expect(api.me).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('s09-tab-mine'));
    expect(await screen.findByTestId('signin-required')).toBeInTheDocument();
    expect(api.skills).not.toHaveBeenCalled();
  });

  it("shows the server's first page at once, before its own fetch answers, then refreshes it", async () => {
    let answer: (v: ReturnType<typeof marketCardFixture>[]) => void = () => {};
    const pending = new Promise<ReturnType<typeof marketCardFixture>[]>((r) => (answer = r));
    const { api } = renderWithProviders(<MarketplaceScreen initialCards={[marketCardFixture()]} />, { api: base({ market: () => pending }) });
    // In the first render: no skeleton, no waiting on the bundle or the session.
    expect(screen.getByTestId(`s09-card-${SKILL_ID}`)).toBeInTheDocument();
    await waitFor(() => expect(api.market).toHaveBeenCalledWith({ sort: 'winrate' }));
    answer([]);
    await waitFor(() => expect(screen.queryByTestId(`s09-card-${SKILL_ID}`)).not.toBeInTheDocument());
  });

  it('shows cards with price in NEAR (bigint), the ranked and benchmark proof line and the corner chip', async () => {
    const { api } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base() });
    const card = await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(within(card).getByTestId('s09-price')).toHaveTextContent('1.5 NEAR');
    expect(within(card).getByTestId('s09-proof')).toHaveTextContent('Won 63% of 16 ranked · Benchmark 71%');
    expect(within(card).getByTestId('s09-rarity')).toHaveTextContent('Unrated');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('s09-drawer')).toHaveTextContent('Pick a skill to see its proof.');
    expect(api.market).toHaveBeenCalledWith({ sort: 'winrate' });
  });

  it('tags each card with the roles that may equip it (any when the server sends none)', async () => {
    const scout = marketCardFixture({ skill: { ...marketCardFixture().skill, id: 'skl_01J0000000000000000000SCOUT', roles: ['Scout', 'Hauler'] } });
    renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base({ market: async () => [marketCardFixture(), scout] }) });
    const anyCard = await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(within(anyCard).getByTestId('role-tag')).toHaveTextContent('Any role');
    const scoutCard = screen.getByTestId('s09-card-skl_01J0000000000000000000SCOUT');
    expect(within(scoutCard).getByTestId('role-tag')).toHaveTextContent('Scout · Hauler');
  });

  it('opens a card in the side drawer, moves the URL there, and closes on ✕ and Esc', async () => {
    const { user, api } = renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({ marketSkill: async () => marketDetailFixture() }),
    });
    const card = await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    const drawer = screen.getByTestId('s09-drawer');
    expect(await within(drawer).findByTestId('s10-name')).toHaveTextContent('Dam First');
    expect(api.marketSkill).toHaveBeenCalledWith(SKILL_ID);
    expect(window.location.pathname).toBe(`/market/${SKILL_ID}`);
    expect(testRouter.push).not.toHaveBeenCalled();

    await user.click(within(drawer).getByTestId('s10-close'));
    expect(drawer).toHaveTextContent('Pick a skill to see its proof.');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(window.location.pathname).toBe('/market');

    await user.click(card);
    expect(await within(drawer).findByTestId('s10-name')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(drawer).queryByTestId('s10-name')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/market');
  });

  it('shows My skills: written and held skills merged, statuses, no filters, never the prompt', async () => {
    const mine = { id: ME_ID, handle: 'ada', nearAccountId: null };
    const { user, api } = renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({
        me: async () => meFixture({ account: { ...meFixture().account, id: ME_ID } }),
        skills: async (tab) =>
          tab === 'owned'
            ? [skillRowFixture({ id: 'skl_01J0000000000000000000HELD', name: 'Read the Room', status: 'Minted' })]
            : [skillRowFixture({ creatorAccount: mine, status: 'Draft' })],
        marketSkill: async () =>
          marketDetailFixture({ skill: { ...marketDetailFixture().skill, status: 'Draft', creatorAccount: mine }, listing: undefined }),
      }),
    });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.click(screen.getByRole('tab', { name: 'My skills' }));
    expect(screen.getByRole('tab', { name: 'My skills' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My skills');
    expect(screen.queryByTestId('s09-filters')).not.toBeInTheDocument();
    const grid = await screen.findByTestId('s09-mine');
    const draft = within(grid).getByTestId(`s09-card-${SKILL_ID}`);
    expect(within(draft).getByText('Draft', { selector: 'span:not([data-testid])' })).toBeInTheDocument();
    expect(within(draft).getByTestId('s09-rarity')).toHaveTextContent('Draft');
    expect(within(draft).getByText('Yours')).toBeInTheDocument();
    const held = within(grid).getByTestId('s09-card-skl_01J0000000000000000000HELD');
    expect(within(held).getByText('Owned', { selector: '[class*="status"]' })).toBeInTheDocument();
    expect(api.skills).toHaveBeenCalledWith('written');
    expect(api.skills).toHaveBeenCalledWith('owned');

    await user.click(draft);
    const drawer = screen.getByTestId('s09-drawer');
    expect(await within(drawer).findByTestId('s10-prompt-own')).toHaveTextContent('Prompt · only you can read this.');
    expect(within(drawer).getByRole('link', { name: 'read and edit it in the editor' })).toHaveAttribute('href', `/skills/${SKILL_ID}/edit`);
    expect(within(drawer).getByTestId('s10-edit')).toHaveTextContent('Test and mint in the editor');
    expect(within(drawer).queryByTestId('s10-soon-benchmark')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET_PROMPT);
    expect(api.skill).not.toHaveBeenCalled();
  });

  it('says when My skills is empty', async () => {
    const { user } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base({ skills: async () => [] }) });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.click(screen.getByTestId('s09-tab-mine'));
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('You have no skills yet. Write one, or buy one on the Exchange.');
  });

  it('formats tiny and huge yocto prices exactly', async () => {
    renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({
        market: async () => [
          marketCardFixture({ priceYocto: '123456789012345678901234567890' }),
        ],
      }),
    });
    expect(await screen.findByTestId('s09-price')).toHaveTextContent('123456.789 NEAR');
  });

  it('filters by tag and sort, and says what the list shows', async () => {
    const { user, api } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base() });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.click(screen.getByTestId('s09-tag-filter-spreads'));
    expect(screen.getByTestId('s09-tag-filter-spreads')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(api.market).toHaveBeenLastCalledWith({ tag: 'spreads', sort: 'winrate' }));
    await user.selectOptions(screen.getByTestId('s09-sort'), 'price');
    await waitFor(() => expect(api.market).toHaveBeenLastCalledWith({ tag: 'spreads', sort: 'price' }));
    expect(await screen.findByTestId('s09-result-line')).toHaveTextContent('1 skill handles spreads');
  });

  it('sorts by ranked win rate and by benchmark score', async () => {
    const { user, api } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base() });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(screen.getByRole('option', { name: 'Ranked win rate' })).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('s09-sort'), 'winrate');
    await waitFor(() => expect(api.market).toHaveBeenLastCalledWith({ sort: 'winrate' }));
    await user.selectOptions(screen.getByTestId('s09-sort'), 'benchmark');
    await waitFor(() => expect(api.market).toHaveBeenLastCalledWith({ sort: 'benchmark' }));
  });

  it('shows the empty line with Clear the filter', async () => {
    const { user } = renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({ market: async (q) => (q?.tag ? [] : [marketCardFixture()]) }),
    });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.click(screen.getByTestId('s09-tag-filter-breakable'));
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('No skills handle breakable yet. Clear the filter or write one.');
    await user.click(screen.getByTestId('s09-clear-filters'));
    expect(await screen.findByTestId(`s09-card-${SKILL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId('s09-tag-filter-breakable')).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels unrated, owned, starter and own skills', async () => {
    renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({
        market: async () => [
          marketCardFixture({
            owned: true,
            rankedWinRate: null,
            rankedMatches: 0,
            benchmarkScore: null,
          }),
          marketCardFixture({
            skill: { ...marketCardFixture().skill, id: 'skl_01J000000000000000000FLOOD', accountBound: true },
            priceYocto: null,
          }),
          marketCardFixture({
            skill: { ...marketCardFixture().skill, id: 'skl_01J0000000000000000000MINE' },
            creator: { id: meFixture().account.id, handle: 'ada', nearAccountId: null },
          }),
        ],
      }),
    });
    const unrated = await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(within(unrated).getByTestId('s09-proof')).toHaveTextContent('No ranked matches · Not benchmarked');
    expect(within(unrated).getByText('Owned')).toBeInTheDocument();
    const starter = screen.getByTestId('s09-card-skl_01J000000000000000000FLOOD');
    expect(within(starter).getByText('Official · starter')).toBeInTheDocument();
    expect(within(starter).getByText('Not for sale')).toBeInTheDocument();
    expect(within(screen.getByTestId('s09-card-skl_01J0000000000000000000MINE')).getByText('Yours')).toBeInTheDocument();
  });

  it('searches by skill or creator on the client', async () => {
    const { user } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base() });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    await user.type(screen.getByLabelText('Search'), 'nobody');
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('No skill or creator matches that search');
    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), 'tide');
    expect(await screen.findByTestId(`s09-card-${SKILL_ID}`)).toBeInTheDocument();
  });

  it('shows skeletons while loading, then an error card with Retry while filters stay usable', async () => {
    renderWithProviders(<MarketplaceScreen />, {
      handle: 'ada',
      api: base({
        market: async () => {
          throw new ApiError(500, 'internal', 'boom');
        },
      }),
    });
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(await screen.findByTestId('error-card')).toBeInTheDocument();
    expect(screen.getByTestId('s09-tag-filter-spreads')).toBeEnabled();
  });

  it('never renders prompt text and never asks for it', async () => {
    const { api } = renderWithProviders(<MarketplaceScreen />, { handle: 'ada', api: base() });
    await screen.findByTestId(`s09-card-${SKILL_ID}`);
    expect(document.body.textContent).not.toContain(SECRET_PROMPT);
    expect(api.skill).not.toHaveBeenCalled();
  });
});

describe('mergeMine', () => {
  it('puts written skills first, then held ones, one card per skill', () => {
    const a = skillRowFixture({ id: 'skl_a' });
    const b = skillRowFixture({ id: 'skl_b' });
    const merged = mergeMine([a], [skillRowFixture({ id: 'skl_a', version: 2 }), b]);
    expect(merged.map((m) => [m.row.id, m.row.version, m.held])).toEqual([
      ['skl_a', 1, true],
      ['skl_b', 1, true],
    ]);
  });
});

describe('v2ProofLine', () => {
  it('says the ranked win rate and the benchmark score, or that there are none', () => {
    expect(v2ProofLine({ rankedWinRate: 0.625, rankedMatches: 16, benchmarkScore: 0.71 })).toBe('Won 63% of 16 ranked · Benchmark 71%');
    expect(v2ProofLine({ rankedWinRate: null, rankedMatches: 0, benchmarkScore: 0 })).toBe('No ranked matches · Benchmark 0%');
    expect(v2ProofLine({ rankedWinRate: 0, rankedMatches: 3, benchmarkScore: null })).toBe('Won 0% of 3 ranked · Not benchmarked');
  });
});

describe('forSaleFirst', () => {
  it('puts skills on sale first and keeps each group in the API order', () => {
    const cards = [
      { id: 'a', priceYocto: null },
      { id: 'b', priceYocto: '1' },
      { id: 'c', priceYocto: null },
      { id: 'd', priceYocto: '2' },
    ];
    expect(forSaleFirst(cards).map((c) => c.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
