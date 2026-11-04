import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { MindSkills } from '../v2/hud/MindSkills';
import { emptyForm, toBody, validateForm } from './lib';
import { SkillDetailScreen } from './SkillDetailScreen';
import { SkillEditorScreen } from './SkillEditorScreen';
import { SKILL_ID, marketCardFixture, marketDetailFixture, skillRowFixture, skillWithTextFixture } from './testFixtures';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('skill triggers (web)', () => {
  it('the form sends null for always and the trigger otherwise, and checks the number', () => {
    expect(toBody(emptyForm()).trigger).toBeNull();
    const f = { ...emptyForm(), trigger: { kind: 'hazard_within' as const, tiles: 2 } };
    expect(toBody(f).trigger).toEqual({ kind: 'hazard_within', tiles: 2 });
    expect(validateForm(f).trigger).toBeUndefined();
    expect(validateForm({ ...f, trigger: { kind: 'hazard_within', tiles: 0 } }).trigger).toBe('1 to 10 tiles.');
    expect(validateForm({ ...f, trigger: { kind: 'time_left_under', seconds: NaN } }).trigger).toBe('10 to 300 seconds.');
  });

  it('the editor reads back the trigger and saves a new one', async () => {
    const { user, api } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        skill: async () => skillWithTextFixture({ trigger: { kind: 'carrying_item' } }),
        updateSkill: async () => skillRowFixture({ version: 2 }),
      } satisfies Partial<ApiClient>,
    });
    const pick = await screen.findByTestId('s08-trigger');
    expect(pick).toHaveValue('carrying_item');
    await user.selectOptions(pick, 'time_left_under');
    const value = screen.getByTestId('s08-trigger-value');
    expect(value).toHaveValue(60);
    await user.clear(value);
    await user.type(value, '45');
    expect(screen.getByTestId('s08-trigger-hint')).toHaveTextContent('Only while: under 45 s left.');
    await user.click(screen.getByTestId('s08-save'));
    await waitFor(() =>
      expect(api.updateSkill).toHaveBeenCalledWith(SKILL_ID, expect.objectContaining({ trigger: { kind: 'time_left_under', seconds: 45 } })),
    );
  });

  it('the skill detail shows the trigger as public metadata', async () => {
    const skill = { ...marketCardFixture().skill, trigger: { kind: 'behind_on_score' as const } };
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        market: async () => [marketCardFixture()],
        marketSkill: async () => marketDetailFixture({ skill }),
        skill: async () => skillWithTextFixture(),
      } satisfies Partial<ApiClient>,
    });
    expect(await screen.findByTestId('s10-trigger')).toHaveTextContent('When it plays · Only while: behind on score.');
  });

  it('the mind panel lists each skill as active or inactive this tick', () => {
    render(
      <MindSkills
        skills={[
          { name: 'Dam First', trigger: { kind: 'always' }, active: true },
          { name: 'Late Push', trigger: { kind: 'time_left_under', seconds: 60 }, active: false },
        ]}
      />,
    );
    expect(screen.getByTestId('v2-mind-skills')).toHaveTextContent('1 of 2 active');
    const rows = screen.getAllByTestId('v2-mind-skill');
    expect(rows.map((r) => r.getAttribute('data-active'))).toEqual(['true', 'false']);
    expect(rows[1]).toHaveTextContent('Late PushInactiveUnder 60 s left');
  });

  it('the mind panel shows nothing for an agent without skills', () => {
    const { container } = render(<MindSkills skills={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
