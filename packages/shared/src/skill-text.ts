/**
 * The text of one skill version as the decision model reads it: the Prompt, then the Reflexes
 * when the writer added any. Reflexes are the short "every step" rules from the skill editor;
 * without this they were sealed with the version but never reached the model.
 */
export function skillTextForModel(text: { prompt: string; reflexes?: string | null }): string {
  const reflexes = text.reflexes?.trim();
  return reflexes ? `${text.prompt}\n\nReflexes (check these every step):\n${reflexes}` : text.prompt;
}
