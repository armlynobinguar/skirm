# CrewSlot

One slot in the crew builder: an equipped agent, or an empty slot that shows what adding an agent costs.

- **Provide:** `slot` (1-based), `agent` (`{ name, crew?, unlocks?: string[], skills?: string[] }`) or nothing for an empty slot, `onAdd`, `onRemove`, optional `mapUnlocks` (flags unlocks the map lacks), `creditsPerAgent` (credits one more agent holds: the map's step limit).
- The empty slot states the score effect from the multiplier table: one agent ×3.0, two ×1.5, three or more ×1.0. Fewer agents score higher; the UI should make that obvious, never hide it.
- Show filled slots first, then exactly one empty slot.
