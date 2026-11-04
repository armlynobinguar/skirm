import type { FrameAgent, V2Frame } from '@skirm/engine/v2';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2MatchScreen } from '@/features/v2/V2MatchScreen';
import { v2StoreFor } from '@/features/v2/v2Store';
import { OVERVIEW, arenaStore } from '@/features/arena/store';
import type { PlaybookList } from '@/lib/api/playbookTypes';
import { FakeRealtime } from '@/test/fakeRealtime';
import { agentFixture, meFixture, v2FrameFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { PlaybooksSection } from './Playbooks';

const at = '2026-11-03T08:00:00.000Z';
const book = (id: string, name: string, selected = false) => ({ id, name, selected, createdAt: at, updatedAt: at });
const list = (...playbooks: ReturnType<typeof book>[]): PlaybookList => ({ playbooks, max: 5, maxChars: 800 });

describe('Playbooks section', () => {
  it('writes a playbook and lists it by name', async () => {
    let rows: ReturnType<typeof book>[] = [];
    const { api, user } = renderWithProviders(<PlaybooksSection />, {
      handle: 'ana',
      api: {
        playbooks: async () => list(...rows),
        createPlaybook: async (b) => {
          const made = book('pbk_1', b.name, true);
          rows = [made];
          return made;
        },
      },
    });
    expect(await screen.findByText(/No playbooks yet/)).toBeInTheDocument();
    await user.click(screen.getByTestId('playbook-new'));
    await user.type(screen.getByRole('textbox', { name: 'Playbook name' }), 'Haul and scout');
    await user.type(screen.getByRole('textbox', { name: 'Playbook text' }), 'Rook hauls, Wren scouts.');
    expect(screen.getByTestId('playbook-count')).toHaveTextContent('24/800');
    await user.click(screen.getByTestId('playbook-save'));
    expect(api.createPlaybook).toHaveBeenCalledWith({ name: 'Haul and scout', text: 'Rook hauls, Wren scouts.' });
    const item = await screen.findByTestId('playbook-pbk_1');
    expect(item).toHaveTextContent('Haul and scout');
    expect(item).toHaveTextContent('Selected');
  });

  it('selects, edits with the text read back, and deletes', async () => {
    const { api, user } = renderWithProviders(<PlaybooksSection />, {
      handle: 'ana',
      api: {
        playbooks: async () => list(book('pbk_1', 'Haul', true), book('pbk_2', 'Deny')),
        selectPlaybook: async (id) => ({ selected: id }),
        playbook: async (id) => ({ ...book(id, 'Deny'), text: 'Everyone denies the middle.' }),
        updatePlaybook: async (id, b) => book(id, b.name ?? 'Deny'),
        deletePlaybook: async () => ({ deleted: true }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Select Deny' }));
    expect(api.selectPlaybook).toHaveBeenCalledWith('pbk_2');
    await user.click(screen.getByRole('button', { name: 'Edit Deny' }));
    expect(await screen.findByDisplayValue('Everyone denies the middle.')).toBeInTheDocument();
    await user.click(screen.getByTestId('playbook-save'));
    expect(api.updatePlaybook).toHaveBeenCalledWith('pbk_2', { name: 'Deny', text: 'Everyone denies the middle.' });
    await user.click(screen.getByRole('button', { name: 'Delete Haul' }));
    expect(api.deletePlaybook).toHaveBeenCalledWith('pbk_1');
  });

  it('blocks a text over the limit', async () => {
    const { user } = renderWithProviders(<PlaybooksSection />, { handle: 'ana', api: { playbooks: async () => ({ ...list(), maxChars: 10 }) } });
    await user.click(await screen.findByTestId('playbook-new'));
    await user.type(screen.getByRole('textbox', { name: 'Playbook name' }), 'Long');
    await user.type(screen.getByRole('textbox', { name: 'Playbook text' }), 'twelve chars');
    expect(screen.getByTestId('playbook-count')).toHaveAttribute('data-over');
    expect(screen.getByTestId('playbook-save')).toBeDisabled();
  });
});

describe('Playbook at lock-in and in the mind panel', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    arenaStore().setLive(null);
    arenaStore().setView(OVERVIEW);
    vi.useRealTimers();
  });

  const WICK = agentFixture({ id: 'agt_wick', name: 'Wick' });

  function lockin(books: PlaybookList) {
    const rt = new FakeRealtime();
    v2StoreFor(rt).queued = [{ agentId: WICK.id, name: 'Wick', tier: 'standard' }];
    const r = renderWithProviders(<V2MatchScreen matchId="mat_pb" />, {
      realtime: rt,
      handle: 'ana',
      path: '/matches/mat_pb',
      search: '',
      api: { me: async () => meFixture({ agents: [WICK] }), skills: async () => [], playbooks: async () => books },
    });
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_pb', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000 });
      rt.emit({ type: 'v2_lockin', matchId: 'mat_pb', lockMs: 30_000, rival: { agents: 1 } });
    });
    return { ...r, rt };
  }

  it('keeps the selected playbook unless the picker changes it', async () => {
    const { rt, user } = lockin(list(book('pbk_1', 'Haul', true), book('pbk_2', 'Deny')));
    const picker = await screen.findByRole('combobox', { name: 'Playbook for this match' });
    expect(picker).toHaveValue('pbk_1');
    await user.selectOptions(picker, 'pbk_2');
    await user.click(screen.getByTestId('v2-lock'));
    expect(rt.sentOf('v2_lock_in')).toEqual([{ type: 'v2_lock_in', matchId: 'mat_pb', tiers: ['standard'], playbookId: 'pbk_2' }]);
  });

  it('sends none when the picker clears it, and nothing extra when unchanged', async () => {
    const { rt, user } = lockin(list(book('pbk_1', 'Haul', true)));
    const picker = await screen.findByRole('combobox', { name: 'Playbook for this match' });
    await user.selectOptions(picker, '');
    await user.click(screen.getByTestId('v2-lock'));
    expect(rt.sentOf('v2_lock_in')).toEqual([{ type: 'v2_lock_in', matchId: 'mat_pb', tiers: ['standard'], playbookId: null }]);
  });

  it("shows the playbook's name in your agent's mind, not a rival's", async () => {
    const rt = new FakeRealtime();
    v2StoreFor(rt).queued = [{ agentId: 'agt_1', name: 'Wick', tier: 'standard' }];
    renderWithProviders(<V2MatchScreen matchId="mat_pbm" />, { realtime: rt, handle: 'ana', path: '/matches/mat_pbm', search: '' });
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_pbm', team: 'A', mapId: 'copper-hollow', ranked: true, acceptMs: 10_000 });
      rt.emit({ type: 'v2_lockin', matchId: 'mat_pbm', lockMs: 30_000, rival: { agents: 1 } });
      rt.emit({ type: 'v2_start', matchId: 'mat_pbm', team: 'A', rival: { handle: 'ben' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } });
    });
    const base = v2FrameFixture({ tick: 3 });
    const wren: FrameAgent = { id: 'wren', name: 'Wren', team: 'B', role: 'Scout', x: 30, y: 1, items: [], delivered: 0, down: false, out: false, tier: 'standard' };
    const f: V2Frame = { ...base, agents: [base.agents[0]!, wren], playbook: 'Haul and scout' };
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_pbm', frame: f }));
    act(() => void fireEvent.keyDown(window, { key: 'Enter' }));
    fireEvent.click(screen.getByTestId(`v2-card-${base.agents[0]!.id}`));
    act(() => void fireEvent.keyDown(window, { key: 'v' }));
    await waitFor(() => expect(screen.getByTestId('v2-mind-playbook')).toHaveTextContent('Playbook: Haul and scout'));
    act(() => void fireEvent.keyDown(window, { key: 'ArrowRight' }));
    expect(within(screen.getByTestId('v2-tpv')).getByText('rival crew')).toBeInTheDocument();
    expect(screen.queryByTestId('v2-mind-playbook')).not.toBeInTheDocument();
  });
});
