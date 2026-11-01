# AgentChip

An agent with its name, unlocks and either skill count or Elo, for lists and pickers.

- **Provide:** `agent` (`{ name, crew?, state?, unlocks?: string[], skills?: number, elo?: number }`).
- Elo is per agent (concept doc: PvP modes), shown in mono.
- Use in crew pickers, match lobbies and agent lists. In a crew builder use `CrewSlot` instead.
