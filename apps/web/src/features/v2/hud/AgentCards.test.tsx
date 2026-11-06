import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { AgentCards } from './AgentCards';

describe('agent cards: rivals not seen yet', () => {
  it('collapses unseen rivals into one slim strip instead of a card each', () => {
    render(<AgentCards team="A" mapId="copper-hollow" tick={1} cards={[]} unseen={3} pressed={null} onPick={() => {}} onWatch={() => {}} />);
    const strips = screen.getAllByTestId('v2-unseen-strip');
    expect(strips).toHaveLength(1);
    expect(strips[0]).toHaveAccessibleName('3 rival agents not seen yet');
    expect(strips[0]).toHaveTextContent('3 unseen');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows seen rivals as cards next to the strip for the rest', () => {
    const f = v2FrameFixture({ mapId: 'copper-hollow', tick: 3 });
    const rival = { ...f.agents[0]!, id: 'wren', name: 'Wren', team: 'B' as const };
    render(<AgentCards team="A" mapId="copper-hollow" tick={3} cards={[{ agent: rival, inSight: false, slot: 0 }]} unseen={1} pressed={null} onPick={() => {}} onWatch={() => {}} />);
    expect(screen.getByTestId('v2-card-wren')).toHaveTextContent('Wren');
    expect(screen.getByLabelText('Rival agent not seen yet')).toHaveTextContent('1 unseen');
  });

  it('draws no strip once every rival has been seen', () => {
    render(<AgentCards team="A" mapId="copper-hollow" tick={1} cards={[]} pressed={null} onPick={() => {}} onWatch={() => {}} />);
    expect(screen.queryByTestId('v2-unseen-strip')).not.toBeInTheDocument();
  });
});
