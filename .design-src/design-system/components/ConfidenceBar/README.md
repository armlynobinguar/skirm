# ConfidenceBar

What the decision model chose this tick and how sure it was: the top action plus the probabilities of the alternatives.

- **Provide:** `options` (`[{ action, p }]`, the legal actions with probabilities from `chooseAction`), optional `agentName`, `crew`, `tick`, `max` rows (default 4, the rest summed as "N more"), `lowAt` (default 0.4), `timedOut` (the agent missed the time limit and waited).
- Rows are sorted by probability for reading. The engine still sends options in its fixed canonical order; sorting is display only.
- The top pick is `chalk`, others `ink-faint`. Below `lowAt` the card says "Unsure" with a warning icon.
- Action labels are engine action names plus a direction, e.g. `move N`, `place_block E` (*proposed* format; the legal-action format is still open).
- Never show plan or reasoning text here; skills stay hidden.
