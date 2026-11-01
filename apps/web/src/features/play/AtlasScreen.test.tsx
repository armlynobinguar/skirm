import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import { ROTATION_INDEX } from '@/features/arena/world';
import { renderWithProviders } from '@/test/render';
import { AtlasScreen, DiffPicker, clockAt, goalCount, plural, vitals } from './AtlasScreen';
import { mapById } from '@/features/arena/world';

afterEach(() => act(() => arenaStore().setMap(ROTATION_INDEX)));

describe('Map atlas', () => {
  it('puts the first five maps on the starter side and the rest on the veteran side, rotation map chosen', () => {
    renderWithProviders(<AtlasScreen />, { handle: 'ada', path: '/maps' });
    const starter = screen.getByRole('region', { name: /Starter maps/ });
    const veteran = screen.getByRole('region', { name: /Veteran maps/ });
    expect(within(starter).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Saltmarsh Weir, Tutorial',
      'Ashfall Orchard, Starter',
      'Frostline Depot, Starter',
      'Glasshouse Ruins, Standard',
      'Copper Hollow, Standard',
    ]);
    expect(within(veteran).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByTestId('atlas-map-copper-hollow')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('atlas-center')).toHaveTextContent('Copper Hollow');
    expect(screen.getByTestId('atlas-vitals')).toHaveTextContent('water · 41×19 · first to 4 · start the pump · fog');
    expect(screen.getByTestId('atlas-ranked')).toHaveAttribute('href', '/pvp');
    expect(screen.getByTestId('atlas-practice')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=normal');
    expect(screen.getByTestId('atlas-practice')).toHaveTextContent('Practice · Normal');
  });

  it('picking a map switches the arena and the centre', async () => {
    const { user } = renderWithProviders(<AtlasScreen />, { handle: 'ada', path: '/maps' });
    await user.click(screen.getByTestId('atlas-map-basalt-stair'));
    expect(arenaStore().get().mapIdx).toBe(8);
    expect(screen.getByTestId('atlas-center')).toHaveTextContent('Basalt Stair');
    expect(screen.getByTestId('atlas-center')).toHaveTextContent('09');
    expect(screen.getByTestId('atlas-map-basalt-stair')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the details drawer with goal, features and themed verbs', async () => {
    const { user } = renderWithProviders(<AtlasScreen />, { handle: 'ada', path: '/maps' });
    await user.click(screen.getByTestId('atlas-play'));
    await user.click(screen.getByTestId('atlas-details'));
    expect(screen.getByTestId('atlas-play')).toHaveAttribute('aria-expanded', 'false');
    const d = screen.getByTestId('atlas-drawer');
    expect(d).toHaveTextContent('First crew to deliver 4 lamps to the cage lift wins on Normal. At 5:00, more delivered wins.');
    expect(within(d).getByTestId('atlas-goals')).toHaveTextContent(
      'Easy: Light the way · Normal: Shore the tunnels · Hard: Echo in the dark · Agentic: Start the pump · Mega Agentic: Trust your lamp',
    );
    expect(d).toHaveTextContent('2 each side + 3 contested in the middle + 1 supply drop. Fewer than both crews need.');
    expect(d).toHaveTextContent('Supply drop at 3:40');
    expect(d).toHaveTextContent('Hand-built layout.');
    const verbs = within(screen.getByTestId('atlas-verbs'));
    expect(verbs.getByText('Dig rubble')).toBeInTheDocument();
    expect(verbs.getByText('remove_solid')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByTestId('atlas-drawer')).not.toBeInTheDocument();
  });

  it('opens the play menu from the diamond; a second click, Escape or a click outside closes it', async () => {
    const { user } = renderWithProviders(<AtlasScreen />, { handle: 'ada', path: '/maps' });
    const play = screen.getByTestId('atlas-play');
    expect(play).toHaveAttribute('aria-expanded', 'false');
    expect(play).toHaveAccessibleName('Play Copper Hollow');
    expect(play).toHaveTextContent('05');
    const menu = screen.getByTestId('atlas-menu');
    expect(within(menu).getByTestId('atlas-practice')).toHaveAttribute('tabindex', '-1');
    await user.click(play);
    expect(play).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByTestId('atlas-practice')).not.toHaveAttribute('tabindex');
    expect(within(menu).getByTestId('atlas-ranked')).toHaveAttribute('href', '/pvp');
    await user.click(play);
    expect(play).toHaveAttribute('aria-expanded', 'false');
    await user.click(play);
    await user.keyboard('{Escape}');
    expect(play).toHaveAttribute('aria-expanded', 'false');
    await user.click(play);
    await user.click(screen.getByTestId('atlas-map-saltmarsh-weir'));
    expect(play).toHaveAttribute('aria-expanded', 'false');
  });

  it('picks a difficulty: goal box, vitals, Practice link with ?d=, Normal by default', async () => {
    const { user } = renderWithProviders(<AtlasScreen />, { handle: 'ada', path: '/maps' });
    const seg = screen.getByRole('group', { name: 'Difficulty' });
    expect(
      within(seg)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Easy', 'Normal', 'Hard', 'Agentic', 'Mega Agentic']);
    expect(within(seg).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('Normal · goal on Copper Hollow');
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('Shore the tunnels');
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('The map as designed · ranked plays this');

    await user.click(within(seg).getByRole('button', { name: 'Mega Agentic' }));
    expect(within(seg).getByRole('button', { name: 'Mega Agentic' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('Mega Agentic · goal on Copper Hollow');
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('Trust your lamp');
    expect(screen.getByTestId('atlas-vitals')).toHaveTextContent('water · 41×19 · first to 5 · start the pump · fog');
    expect(screen.getByTestId('atlas-practice')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=mega');
    expect(screen.getByTestId('atlas-practice')).toHaveTextContent('Practice · Mega Agentic');
    // Ranked ignores the pick: the hub always queues Normal.
    expect(screen.getByTestId('atlas-ranked')).toHaveAttribute('href', '/pvp');

    // The pick stays when the map changes, and the drawer's Practice link carries it.
    await user.click(screen.getByTestId('atlas-map-saltmarsh-weir'));
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('High tide');
    await user.click(screen.getByTestId('atlas-play'));
    await user.click(screen.getByTestId('atlas-details'));
    expect(screen.getByTestId('atlas-drawer-practice')).toHaveAttribute('href', '/maps/saltmarsh-weir/crew?d=mega');
  });

  it('locks the picker to Normal for ranked', async () => {
    const m = mapById('copper-hollow')!;
    const picks: string[] = [];
    const { user } = renderWithProviders(<DiffPicker map={m} value="hard" onChange={(d) => picks.push(d)} lock />);
    const seg = screen.getByRole('group', { name: 'Difficulty' });
    expect(within(seg).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(seg).getByRole('button', { name: 'Normal' })).toBeEnabled();
    for (const n of ['Easy', 'Hard', 'Agentic', 'Mega Agentic']) expect(within(seg).getByRole('button', { name: n })).toBeDisabled();
    await user.click(within(seg).getByRole('button', { name: 'Hard' }));
    expect(picks).toEqual([]);
    expect(screen.getByTestId('atlas-goal')).toHaveTextContent('Ranked always plays Normal, so both crews chase the same goal.');
  });

  it('moves the delivery count by the difficulty, never below 2', () => {
    const weir = mapById('saltmarsh-weir')!;
    const hollow = mapById('copper-hollow')!;
    expect(goalCount(hollow, 'normal')).toBe(4);
    expect(goalCount(hollow, 'easy')).toBe(3);
    expect(goalCount(hollow, 'agentic')).toBe(5);
    expect(goalCount(weir, 'easy')).toBe(Math.max(2, weir.A.n - 1));
    expect(vitals(hollow)).toBe('water · 41×19 · first to 4 · start the pump · fog');
    expect(plural('Lamp oil', 4)).toBe('lamps');
    expect(plural('Flare', 3)).toBe('flares');
    expect(plural('Flare', 1)).toBe('flare');
  });

  it('formats supply drop times as the match clock', () => {
    expect(clockAt(35)).toBe('3:50');
    expect(clockAt(70)).toBe('2:40');
  });
});
