import { describe, expect, it } from 'vitest';
import { skillTextForModel } from '../src/skill-text';

describe('skillTextForModel', () => {
  it('is the prompt alone when the skill has no reflexes', () => {
    expect(skillTextForModel({ prompt: 'Seal the gap.' })).toBe('Seal the gap.');
    expect(skillTextForModel({ prompt: 'Seal the gap.', reflexes: null })).toBe('Seal the gap.');
    expect(skillTextForModel({ prompt: 'Seal the gap.', reflexes: '   ' })).toBe('Seal the gap.');
  });

  it('adds the reflexes after the prompt, labelled as every-step rules', () => {
    expect(skillTextForModel({ prompt: 'Seal the gap.', reflexes: 'If water is adjacent, place a block.' })).toBe(
      'Seal the gap.\n\nReflexes (check these every step):\nIf water is adjacent, place a block.',
    );
  });
});
