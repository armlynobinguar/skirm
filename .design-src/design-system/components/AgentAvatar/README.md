# AgentAvatar

An agent as players see it everywhere: a chalk circle with a `>_` face.

- **Provide:** `size` (px, default 32), optional `crew` (`a` or `b`, adds a crew ring and, at 28px+, the letter), `state` (`idle`, `acting`, `lost`), `label` (the agent's name, for screen readers).
- Under 20px the face simplifies to two eyes.
- `acting` pulses a ring while the decision model is choosing (PvP). `lost` greys the body and shows an X face.
- The circle is reserved for agents. Don't use it for player profile pictures; players are shown by name.
