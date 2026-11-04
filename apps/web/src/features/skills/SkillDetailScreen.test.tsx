import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { SkillDetailScreen } from './SkillDetailScreen';
import { NEEDS_MODEL } from './lib';
import { trialOutcome } from './SkillDetailScreen';
import {
  ME_ID,
  SECRET_PROMPT,
  SECRET_REFLEXES,
  SKILL_ID,
  benchmarkFixture,
  marketCardFixture,
  marketDetailFixture,
  offlineBenchmark,
  skillWithTextFixture,
  trialFixture,
} from './testFixtures';

const linked = () => meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } });

function base(o: Partial<ApiClient> = {}): Partial<ApiClient> {
  return {
    me: async () => meFixture(),
    market: async () => [marketCardFixture()],
    marketSkill: async () => marketDetailFixture(),
    skill: async () => skillWithTextFixture(),
    ...o,
  };
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('S10 Skill detail', () => {
  it('shows the header and sales, never the text', async () => {
    const { api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { handle: 'ada', api: base() });
    expect(await screen.findByTestId('s10-name')).toHaveTextContent('Dam First');
    expect(screen.getByTestId('s10-price')).toHaveTextContent('1.5 NEAR');
    expect(screen.getByTestId('s10-creator')).toHaveTextContent('by tidecaller · listed by tidecaller');
    expect(within(screen.getByTestId('s10-sales')).getByText(/Listed by tidecaller/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET_PROMPT);
    expect(document.body.textContent).not.toContain(SECRET_REFLEXES);
    expect(api.skill).not.toHaveBeenCalled();
  });

  it('opens as the Exchange drawer on a /market/[skillId] deep link, and closing goes back to /market', async () => {
    window.history.replaceState(null, '', `/market/${SKILL_ID}`);
    const { user } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { handle: 'ada', path: `/market/${SKILL_ID}`, api: base() });
    expect(screen.getByTestId('screen-s09')).toBeInTheDocument();
    const drawer = screen.getByTestId('s09-drawer');
    expect(await within(drawer).findByTestId('s10-name')).toHaveTextContent('Dam First');
    expect(await screen.findByTestId(`s09-card-${SKILL_ID}`)).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(drawer).getByTestId('s10-close'));
    expect(window.location.pathname).toBe('/market');
    expect(drawer).toHaveTextContent('Pick a skill to see its proof.');
  });

  it('shows the rarity band, the encrypted prompt and the version lock hash', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () =>
          marketDetailFixture({
            pinned: { version: 1, promptSha256: 'c0ffee12'.repeat(8), tokenId: `${SKILL_ID}:1`, mintedAt: '2026-10-26T10:00:00.000Z' },
          }),
      }),
    });
    expect(await screen.findByTestId('s10-rarity')).toHaveTextContent('Unrated');
    expect(screen.getByTestId('s10-encrypted')).toHaveTextContent('PROMPT ENCRYPTED');
    const lock = screen.getByTestId('s10-version-lock');
    expect(lock).toHaveTextContent('What you buy is v1, hash 0xc0ffee12.');
    expect(within(lock).getByTestId('s10-hash')).toHaveTextContent('c0ffee12'.repeat(8));
    expect(within(lock).getByText(`${SKILL_ID}:1`)).toBeInTheDocument();
    expect(within(lock).getByText('26 Oct')).toBeInTheDocument();
  });

  it('falls back to the public prompt hash when the server sends no pin', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { handle: 'ada', api: base() });
    expect(await screen.findByTestId('s10-hash')).toHaveTextContent('a'.repeat(64));
    expect(screen.getByTestId('s10-version-lock')).toHaveTextContent('hash 0xaaaaaaaa');
  });

  it('says the skill was delisted on 404', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () => {
          throw new ApiError(404, 'not_found', 'skill not found');
        },
      }),
    });
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('This skill was delisted or does not exist.');
  });

  it('buys: connect wallet (M01), confirm the api split (M02), dev tx hash', async () => {
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        createSession: async () => ({ account: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' }, created: false }),
        purchaseSkill: async () => ({ owned: true, sale: {} as never }),
      }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    expect(await screen.findByTestId('m01-connect-wallet')).toBeInTheDocument();
    await user.click(screen.getByTestId('m01-wallet-meteor'));
    await user.click(screen.getByTestId('m01-connect'));
    const m02 = await screen.findByTestId('m02-confirm-transaction');
    expect(within(m02).getByTestId('m02-price')).toHaveTextContent('1.5 NEAR');
    expect(within(m02).getByTestId('m02-royalty')).toHaveTextContent('0.075 NEAR');
    expect(within(m02).getByTestId('m02-fee')).toHaveTextContent('0.075 NEAR');
    expect(within(m02).getByTestId('m02-seller')).toHaveTextContent('1.35 NEAR');
    expect(within(m02).getByTestId('m02-network-fee')).toHaveTextContent('about 0.001 NEAR');
    expect(within(m02).getByTestId('m02-total')).toHaveTextContent('1.501 NEAR');
    expect(within(m02).getByText('Platform fee · 5%')).toBeInTheDocument();
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() =>
      expect(api.purchaseSkill).toHaveBeenCalledWith(SKILL_ID, {
        txHash: expect.stringMatching(/^dev:1500000000000000000000000:[a-z0-9]+$/),
        version: 1,
      }),
    );
    expect(await screen.findByTestId('m02-done')).toHaveTextContent('Dam First is yours');
  });

  it('shows a failed purchase and lets the buyer try again', async () => {
    const { user } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        me: async () => linked(),
        purchaseSkill: async () => {
          throw new ApiError(422, 'underpaid', 'the amount is below the listed price');
        },
      }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent('the amount is below the listed price');
    expect(screen.getByTestId('m02-confirm')).toHaveTextContent('Try again');
  });

  it('equips an owned skill on an agent', async () => {
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () => marketDetailFixture({ owned: true, listing: undefined }),
        patchAgent: async (id) => ({ ...meFixture().agents[1]!, id }),
      }),
    });
    const btn = await screen.findByTestId('s10-equip-btn');
    await waitFor(() => expect(btn).toHaveTextContent('Equip on Rook'));
    await user.click(btn);
    await waitFor(() =>
      expect(api.patchAgent).toHaveBeenCalledWith('agt_01J0000000000000000000ROOK', {
        skills: [
          { id: 'skl_01J0000000000000000000FLOOD', version: 1 },
          { id: SKILL_ID, version: 1 },
        ],
      }),
    );
  });

  it('shows the role tag and offers only agents of the skill role, saying why the others cannot take it', async () => {
    const runnerSkill = { ...marketCardFixture().skill, roles: ['Runner' as const] };
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () => marketDetailFixture({ skill: runnerSkill, owned: true, listing: undefined }),
        patchAgent: async (id) => ({ ...meFixture().agents[1]!, id }),
      }),
    });
    const btn = await screen.findByTestId('s10-equip-btn');
    expect(screen.getAllByTestId('role-tag')[0]).toHaveTextContent('Runner');
    // Rook is a Builder: listed, but disabled; Wren (Runner) is picked.
    await waitFor(() => expect(btn).toHaveTextContent('Equip on Wren'));
    const rook = within(screen.getByTestId('s10-equip-agent')).getByRole('option', { name: /Rook/ });
    expect(rook).toBeDisabled();
    expect(rook).toHaveTextContent('wrong role');
    await user.selectOptions(screen.getByTestId('s10-equip-agent'), 'agt_01J0000000000000000000MOSS');
    await user.click(btn);
    await waitFor(() =>
      expect(api.patchAgent).toHaveBeenCalledWith('agt_01J0000000000000000000MOSS', { skills: [{ id: SKILL_ID, version: 1 }] }),
    );
  });

  it('disables equip with the reason when no agent has the skill role', async () => {
    const scoutSkill = { ...marketCardFixture().skill, roles: ['Scout' as const] };
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ marketSkill: async () => marketDetailFixture({ skill: scoutSkill, owned: true, listing: undefined }) }),
    });
    const btn = await screen.findByTestId('s10-equip-btn');
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('s10-equip-role')).toHaveTextContent('For Scout only; this agent is a Builder');
  });

  it('lists an owned minted skill for resale after M02 shows what the seller receives', async () => {
    const mine = marketCardFixture().skill;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        me: async () => linked(),
        marketSkill: async () =>
          marketDetailFixture({
            owned: true,
            listing: undefined,
            skill: { ...mine, status: 'Minted', creatorAccount: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' } },
          }),
        listSkill: async () => ({ id: 'lst_2' }) as never,
      }),
    });
    await user.click(await screen.findByTestId('s10-list'));
    expect(screen.getByText('Enter a price in NEAR, e.g. 1.5')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Resale price'), '2');
    await user.click(screen.getByTestId('s10-list'));
    const m02 = await screen.findByTestId('m02-confirm-transaction');
    expect(within(m02).getByTestId('m02-royalty')).toHaveTextContent('0 NEAR');
    expect(within(m02).getByTestId('m02-fee')).toHaveTextContent('0.1 NEAR');
    expect(within(m02).getByTestId('m02-total')).toHaveTextContent('1.9 NEAR');
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() =>
      expect(api.listSkill).toHaveBeenCalledWith(SKILL_ID, { priceYocto: '2000000000000000000000000', version: 1 }),
    );
    expect(await screen.findByTestId('m02-done')).toHaveTextContent('Dam First is listed');
  });

  it('refuses malformed prices, without opening M02', async () => {
    const mine = marketCardFixture().skill;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        me: async () => linked(),
        marketSkill: async () =>
          marketDetailFixture({
            owned: true,
            listing: undefined,
            skill: { ...mine, status: 'Minted', creatorAccount: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' } },
          }),
      }),
    });
    const field = await screen.findByLabelText('Resale price');
    const cases: [string, string][] = [
      ['1.2.3', 'Enter a price in NEAR, e.g. 1.5'],
      ['-1', 'Enter a price in NEAR, e.g. 1.5'],
      ['1e3', 'Enter a price in NEAR, e.g. 1.5'],
      ['1,5', 'Enter a price in NEAR, e.g. 1.5'],
      ['1.0000000000000000000000001', 'NEAR has at most 24 decimals.'],
      ['0.000', 'The price must be more than 0 NEAR.'],
      ['99999999999999999', 'That price is too high.'],
    ];
    for (const [text, error] of cases) {
      await user.clear(field);
      await user.type(field, text);
      await user.click(screen.getByTestId('s10-list'));
      expect(await screen.findByText(error)).toBeInTheDocument();
      expect(screen.queryByTestId('m02-confirm-transaction')).not.toBeInTheDocument();
    }
    expect(api.listSkill).not.toHaveBeenCalled();
  });

  it('shows no Buy on your own listing', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () =>
          marketDetailFixture({ listing: { ...marketDetailFixture().listing!, sellerId: ME_ID } }),
      }),
    });
    expect(await screen.findByTestId('s10-own-listing')).toBeInTheDocument();
    expect(screen.queryByTestId('s10-buy')).not.toBeInTheDocument();
  });

  it('shows the benchmark, ranked record per map, counter stats and the hijack gauntlet', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { handle: 'ada', api: base() });
    const bench = await screen.findByTestId('s10-benchmark');
    expect(within(bench).getByTestId('s10-benchmark-score')).toHaveTextContent('56%');
    expect(bench).toHaveTextContent('Record4–2–0');
    expect(bench).toHaveTextContent('HIDDEN SEEDS · HAIKU');
    const ranked = screen.getByTestId('s10-ranked');
    expect(within(ranked).getByTestId('s10-ranked-total')).toHaveTextContent('Won 10 of 16 ranked matches (63%).');
    expect(within(ranked).getByTestId('s10-ranked-copper-hollow')).toHaveTextContent('Copper Hollow70% won7–3–0');
    expect(within(ranked).getByTestId('s10-ranked-basalt-stair')).toHaveTextContent('50% won3–2–1');
    expect(within(screen.getByTestId('s10-counters')).getByTestId('s10-counter-skl_01J0000000000000000000BRCH')).toHaveTextContent('Breach Line v240% won2–3–0');
    const gauntlet = screen.getByTestId('s10-gauntlet');
    expect(within(gauntlet).getByTestId('s10-gauntlet-leak')).toHaveTextContent('17%');
    expect(within(gauntlet).getByTestId('s10-gauntlet-manipulation')).toHaveTextContent('33%');
    expect(screen.queryByText('Soon')).not.toBeInTheDocument();
  });

  it('says benchmarks need a model key on an offline server, with no score', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ marketSkill: async () => marketDetailFixture({ benchmark: offlineBenchmark() }) }),
    });
    const bench = await screen.findByTestId('s10-benchmark');
    expect(within(bench).getByTestId('s10-benchmark-needs-model')).toHaveTextContent(NEEDS_MODEL);
    expect(within(bench).queryByTestId('s10-benchmark-score')).not.toBeInTheDocument();
    expect(bench.textContent).not.toMatch(/\d+%/);
    expect(screen.getByTestId('s10-gauntlet')).toHaveTextContent(NEEDS_MODEL);
    expect(within(screen.getByTestId('s10-gauntlet')).queryByTestId('s10-gauntlet-leak')).not.toBeInTheDocument();
  });

  it('shows a dash, not 0%, for a gauntlet rate the server could not work out', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ marketSkill: async () => marketDetailFixture({ benchmark: benchmarkFixture({ leakRate: null, manipulationRate: null }) }) }),
    });
    const gauntlet = await screen.findByTestId('s10-gauntlet');
    expect(within(gauntlet).getByTestId('s10-gauntlet-leak')).toHaveTextContent('–');
    expect(within(gauntlet).getByTestId('s10-gauntlet-manipulation')).toHaveTextContent('–');
    expect(gauntlet.textContent).not.toMatch(/0%/);
  });

  it('shows empty proof states before any benchmark, ranked match or counter', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        marketSkill: async () =>
          marketDetailFixture({ benchmark: benchmarkFixture({ status: 'queued', score: null }), ranked: { matches: 0, wins: 0, perMap: [] }, counters: { vs: [] } }),
      }),
    });
    expect(await screen.findByTestId('s10-benchmark')).toHaveTextContent('Queued. The platform plays it on hidden seeds');
    expect(screen.getByTestId('s10-ranked')).toHaveTextContent('No ranked matches with this version yet.');
    expect(screen.getByTestId('s10-counters')).toHaveTextContent('No ranked matches against other skills yet.');
    expect(screen.getByTestId('s10-gauntlet')).toHaveTextContent('Shows once the benchmark has run.');
  });

  it('runs a trial with a picked agent, polls it, and shows the results', async () => {
    let calls = 0;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        trials: async () => {
          calls++;
          if (calls === 1) return [];
          if (calls === 2) return [trialFixture({ status: 'running', results: null, agentId: 'agt_01J0000000000000000000WREN' })];
          return [trialFixture({ agentId: 'agt_01J0000000000000000000WREN' })];
        },
        startTrial: async () => ({ trialId: 'trl_01J00000000000000000000001', status: 'queued' }),
      }),
    });
    const panel = await screen.findByTestId('s10-trials');
    expect(panel).toHaveTextContent('3 OF 3 LEFT');
    await waitFor(() => expect(api.trials).toHaveBeenCalledWith(SKILL_ID, 1));
    await user.selectOptions(within(panel).getByTestId('s10-trial-agent'), 'agt_01J0000000000000000000WREN');
    await user.click(within(panel).getByTestId('s10-trial-start'));
    await waitFor(() => expect(api.startTrial).toHaveBeenCalledWith(SKILL_ID, { agentId: 'agt_01J0000000000000000000WREN', version: 1 }));
    expect(await within(panel).findByText('Playing…')).toBeInTheDocument();
    expect(within(panel).getByTestId('s10-trial-start')).toBeDisabled();
    const row = await within(panel).findByTestId('s10-trial-trl_01J00000000000000000000001-0', {}, { timeout: 4000 });
    expect(row).toHaveTextContent('Copper Hollow · EasyWin · 3–0');
    expect(within(panel).getByTestId('s10-trial-trl_01J00000000000000000000001-1')).toHaveTextContent('Loss · 1–2');
    expect(within(panel).getByTestId('s10-trial-trl_01J00000000000000000000001-2')).toHaveTextContent('Draw · 1–1');
    expect(within(panel).getByTestId('s10-trial-trl_01J00000000000000000000001')).toHaveTextContent('Wren');
  });

  it('keeps Run a trial off between the 202 and the refetch that lists the new trial', async () => {
    let listed: (t: ReturnType<typeof trialFixture>[]) => void = () => {};
    let calls = 0;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        trials: () => (++calls === 1 ? Promise.resolve([]) : new Promise((resolve) => (listed = resolve))),
        startTrial: async () => ({ trialId: 'trl_01J00000000000000000000001', status: 'queued' }),
      }),
    });
    const panel = await screen.findByTestId('s10-trials');
    await waitFor(() => expect(api.trials).toHaveBeenCalledTimes(1));
    await user.click(within(panel).getByTestId('s10-trial-start'));
    await waitFor(() => expect(api.trials).toHaveBeenCalledTimes(2));
    expect(api.startTrial).toHaveBeenCalledTimes(1);
    expect(within(panel).getByTestId('s10-trial-start')).toBeDisabled();
    await user.click(within(panel).getByTestId('s10-trial-start'));
    expect(api.startTrial).toHaveBeenCalledTimes(1);
    listed([trialFixture({ status: 'queued', results: null })]);
    expect(await within(panel).findByText('Queued')).toBeInTheDocument();
    expect(within(panel).getByTestId('s10-trial-start')).toBeDisabled();
  });

  it('says a trial on an offline server needs a model key', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ trials: async () => [trialFixture({ status: 'needs_model', results: null })] }),
    });
    const row = await screen.findByTestId('s10-trial-trl_01J00000000000000000000001');
    expect(row).toHaveTextContent(`${NEEDS_MODEL}. This trial did not count.`);
  });

  it('shows Trial limit reached on a 429, and when no trials are left', async () => {
    const { user } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        trials: async () => [],
        startTrial: async () => {
          throw new ApiError(429, 'trial_limit', 'at most 3 trials per skill version');
        },
      }),
    });
    await user.click(await screen.findByTestId('s10-trial-start'));
    expect(await screen.findByTestId('s10-trial-limit')).toHaveTextContent('Trial limit reached');
    expect(screen.getByTestId('s10-trial-start')).toBeDisabled();
  });

  it('disables trials once the three are used', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ trials: async () => [], marketSkill: async () => marketDetailFixture({ trials: { used: 3, left: 0 } }) }),
    });
    expect(await screen.findByTestId('s10-trial-limit')).toHaveTextContent('Trial limit reached');
    expect(screen.getByTestId('s10-trial-start')).toBeDisabled();
    expect(screen.getByTestId('s10-trials')).toHaveTextContent('0 OF 3 LEFT');
  });

  it('offers no trial for a skill you own', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ marketSkill: async () => marketDetailFixture({ owned: true, listing: undefined }) }),
    });
    await screen.findByTestId('s10-benchmark');
    expect(screen.queryByTestId('s10-trials')).not.toBeInTheDocument();
  });
});

describe('trialOutcome', () => {
  it('reads the outcome, or the winner with the buyer as crew A', () => {
    expect(trialOutcome({ mapId: 'm', outcome: 'loss', winner: 'A' })).toBe('loss');
    expect(trialOutcome({ mapId: 'm', winner: 'A' })).toBe('win');
    expect(trialOutcome({ mapId: 'm', winner: 'B' })).toBe('loss');
    expect(trialOutcome({ mapId: 'm', winner: 'draw' })).toBe('draw');
    expect(trialOutcome({ mapId: 'm', winner: null })).toBeNull();
  });
});
