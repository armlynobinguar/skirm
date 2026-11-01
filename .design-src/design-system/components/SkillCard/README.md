# SkillCard

A skill on the marketplace or in the inventory: what it needs, what it handles, how well it clears, and what it costs.

- **Provide:** `skill` (`{ name, creator, unlocks: string[], tags: string[], clearRates: [{ tag, cleared, runs }], price (NEAR), royalty (%) }`), `owned`, `onBuy` or `onEquip`, optional `mapUnlocks` (the current map's unlocks; any needed unlock not in it shows a warning).
- `unlocks` are the unlock names behind the skill's `requires_actions` (Builder for `place_block`, and so on). `tags` is the skill's `handles_tags`.
- Clear-rate bars are `chalk` on `surface-sunken`, never green/red. Fewer than 5 runs on a tag shows the count in `ink-faint` so buyers see thin evidence.
- Never show the prompt or any part of it. Buyers get the right to use a skill, never its text.
- Price in NEAR, mono. Royalty reads "5% to creator on resale".
