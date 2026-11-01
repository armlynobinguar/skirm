# UnlockChip

Shows an unlock (Builder, Digger, Firefighter) and whether the player has it, needs it or the map lacks it.

- **Provide:** `unlock` (`Builder`, `Digger`, `Firefighter`), `state` (`owned` default, `needed`, `missing`).
- `owned`: the action icon on `chalk-soft`. `needed`: dashed border and a lock, for skill requirements. `missing`: `warning` tint and the words "not on map", when a map does not offer the action the skill or agent needs.
- Builder unlocks `place_block`, Digger unlocks `dig`, Firefighter unlocks `extinguish`.
- Always show `missing` before a run starts, so players never waste a run on a skill that cannot act.
