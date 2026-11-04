import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchDecisions } from '@/lib/api/decisions';
import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';
import { Decisions } from './Decisions';
import { decisionAt, lastTick, markLeft, planAt, skillLine, stepMoment } from './hud/decisions';

const SKILL = { id: 'skl_dam', version: 2 };

function fixture(over: Partial<MatchDecisions> = {}): MatchDecisions {
  return {
    matchId: 'mat_v2',
    you: 'A',
    ticks: 10,
    crews: [
      {
        team: 'A',
        own: true,
        brain: 'model',
        agents: [
          { id: 'agt_w', name: 'Wick', role: 'Builder', skills: [SKILL] },
          { id: 'agt_m', name: 'Moss', role: 'Digger', skills: [] },
        ],
        plans: [
          { tick: 1, text: 'Wick dams the left gap.', why: 'Water comes from the left.' },
          { tick: 6, text: 'Everyone delivers.', why: null },
        ],
        decisions: [
          { tick: 1, agentId: 'agt_w', observed: 'At 1,1 carrying 0/2; water 2 steps away.', action: 'move E', reason: 'chosen', skill: { ...SKILL, by: 'model' }, thought: 'Gap first.' },
          { tick: 1, agentId: 'agt_m', observed: 'At 1,2 carrying 0/2.', action: 'move S', reason: 'chosen', skill: null },
          { tick: 4, agentId: 'agt_w', observed: 'At 2,1 carrying 0/2.', action: 'verb dam E', reason: 'chosen', outcome: ['used dam'], skill: { ...SKILL, by: 'inferred' } },
          { tick: 7, agentId: 'agt_w', observed: 'At 9,9 carrying 2/2.', action: 'wait', reason: 'timeout', outcome: ['knocked down by water'], skill: null },
        ],
        moments: [
          { tick: 4, kind: 'switch', team: 'B', agentId: 'agt_r', text: 'Wren flipped the valve' },
          { tick: 7, kind: 'hazard_breach', team: 'A', agentId: 'agt_w', text: 'water reached Wick' },
        ],
      },
    ],
    skills: [{ ...SKILL, name: 'Gap Sealer', mine: true, prompt: 'MY-TEXT: dam the gap.' }],
    ...over,
  };
}

describe('decision timeline helpers', () => {
  const crew = fixture().crews[0]!;
  it('reads the plan and the turn in force at a tick', () => {
    expect(planAt(crew.plans, 5)?.text).toBe('Wick dams the left gap.');
    expect(planAt(crew.plans, 6)?.text).toBe('Everyone delivers.');
    expect(planAt(crew.plans, 0)).toBeNull();
    expect(decisionAt(crew.decisions, 'agt_w', 5)?.tick).toBe(4);
    expect(decisionAt(crew.decisions, 'agt_m', 9)?.tick).toBe(1);
  });

  it('places marks on the scrubber and steps between moments', () => {
    expect(markLeft(1, 10)).toBe(0);
    expect(markLeft(10, 10)).toBe(100);
    expect(markLeft(1, 1)).toBe(0);
    expect(lastTick(crew, 3)).toBe(7);
    expect(stepMoment(crew.moments, 1, 1)).toBe(4);
    expect(stepMoment(crew.moments, 4, 1)).toBe(7);
    expect(stepMoment(crew.moments, 7, 1)).toBeNull();
    expect(stepMoment(crew.moments, 7, -1)).toBe(4);
  });

  it('names the skill or says why there is none', () => {
    const skills = fixture().skills;
    expect(skillLine(crew.decisions[0]!, crew, skills)).toMatchObject({ name: 'Gap Sealer v2', how: 'named by the agent’s model' });
    expect(skillLine(crew.decisions[1]!, crew, skills).how).toBe('No skills equipped.');
    expect(skillLine(crew.decisions[3]!, crew, skills).how).toBe('No equipped skill drove this move.');
    expect(skillLine(crew.decisions[0]!, { ...crew, brain: 'greedy' }, skills).how).toBe('The greedy brain plays without skills.');
  });
});

describe('Decisions', () => {
  it('shows what the agent saw, the plan, the action and the skill at the scrubbed tick', async () => {
    renderWithProviders(<Decisions matchId="mat_v2" />, { handle: 'ada', api: { v2MatchDecisions: async () => fixture() } });
    expect(await screen.findByTestId('v2-decisions-observed')).toHaveTextContent('water 2 steps away');
    expect(screen.getByTestId('v2-decisions-plan')).toHaveTextContent('Wick dams the left gap.');
    expect(screen.getByTestId('v2-decisions-plan')).toHaveTextContent('Why · Water comes from the left.');
    expect(screen.getByTestId('v2-decisions-action')).toHaveTextContent('move E');
    expect(screen.getByTestId('v2-decisions-skill')).toHaveTextContent('Gap Sealer v2 named by the agent’s model');
    expect(screen.getByTestId('v2-decisions-thought')).toHaveTextContent('Gap first.');
    // The player's own skill text sits folded under the chip.
    expect(screen.getByText('Your skill text')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('v2-decisions-scrubber'), { target: { value: '7' } });
    expect(screen.getByTestId('v2-decisions-tick')).toHaveTextContent('Tick 7');
    expect(screen.getByTestId('v2-decisions-action')).toHaveTextContent('wait → knocked down by water');
    expect(screen.getByTestId('v2-decisions-action')).toHaveTextContent('missed the 1.5 s deadline');
    expect(screen.getByTestId('v2-decisions-plan')).toHaveTextContent('Everyone delivers.');
  });

  it('marks the key moments and jumps to them', async () => {
    renderWithProviders(<Decisions matchId="mat_v2" />, { handle: 'ada', api: { v2MatchDecisions: async () => fixture() } });
    const list = await screen.findByTestId('v2-decisions-moments');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(list).getByText('water reached Wick'));
    expect(screen.getByTestId('v2-decisions-tick')).toHaveTextContent('Tick 7');
    fireEvent.click(screen.getByTestId('v2-decisions-prev'));
    expect(screen.getByTestId('v2-decisions-tick')).toHaveTextContent('Tick 4');
    expect(screen.getByTestId('v2-decisions-skill')).toHaveTextContent('the only equipped skill that uses this verb');
    fireEvent.click(screen.getByTestId('v2-decisions-agent-agt_m'));
    expect(screen.getByTestId('v2-decisions-action')).toHaveTextContent('move S');
    expect(screen.getByText(/made no new move on this tick/)).toBeInTheDocument();
  });

  it('says the plan was hidden when a bought skill shaped it, and never shows text for a skill the player did not write', async () => {
    const f = fixture({ skills: [{ ...SKILL, name: 'Gap Sealer', mine: false }] });
    f.crews[0]!.plans = [{ tick: 1, text: null, why: null, hidden: true }];
    renderWithProviders(<Decisions matchId="mat_v2" />, { handle: 'ada', api: { v2MatchDecisions: async () => f } });
    expect(await screen.findByTestId('v2-decisions-plan')).toHaveTextContent('Hidden: a skill this player did not write');
    expect(screen.queryByText('Your skill text')).toBeNull();
  });

  it('switches to the bot crew in practice', async () => {
    const f = fixture();
    f.crews.push({
      team: 'B',
      own: false,
      brain: 'greedy',
      agents: [{ id: 'bot_1', name: 'Greedy', role: 'Runner', skills: [] }],
      plans: [],
      decisions: [{ tick: 1, agentId: 'bot_1', observed: 'At 9,9 carrying 0/2.', action: 'move W', reason: 'chosen', skill: null }],
      moments: [],
    });
    renderWithProviders(<Decisions matchId="mat_v2" />, { handle: 'ada', api: { v2MatchDecisions: async () => f } });
    fireEvent.click(await screen.findByTestId('v2-decisions-crew-B'));
    expect(screen.getByTestId('v2-decisions-action')).toHaveTextContent('move W');
    expect(screen.getByTestId('v2-decisions-skill')).toHaveTextContent('The greedy brain plays without skills.');
  });

  it('says nothing was kept when the timeline is missing or refused', async () => {
    renderWithProviders(<Decisions matchId="mat_v2" />, { handle: 'ada', api: { v2MatchDecisions: async () => Promise.reject(new ApiError(403, 'forbidden', 'no')) } });
    expect(await screen.findByTestId('v2-decisions-none')).toBeInTheDocument();
  });
});
