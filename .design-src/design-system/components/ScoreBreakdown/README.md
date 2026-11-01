# ScoreBreakdown

Shows how the score was made, line by line, using the concept doc's formula.

- **Provide:** `agents`, `steps`, `stepLimit`, optional `skills` (count equipped; upkeep is 25 points each), `upkeep` (a total that overrides 25 × skills), `rankText` ("Top 4% on Flood Gate"), `cleared` (false shows the no-clear state), `failReason`.
- score = 1000 × crew multiplier × (1 − 0.5 × steps / step limit) − skill upkeep, rounded half up (`Math.floor(x + 0.5)`). Multipliers: 1 agent ×3.0, 2 ×1.5, 3+ ×1.0. `Promptlings.scoreRun()` computes the same value.
- Without upkeep, the canonical map scores are: Flood Gate 2,325 solo (27 of 60 steps) and 1,213 with two agents (23 steps; 1,212.5 rounds up); Ember Warehouse 2,130 and 1,065; Magma Mine 1,779 and 1,157. The preview's Flood Gate run with one skill equipped shows 2,325 − 25 = 2,300.
- A failed run shows 0 with the reason; no clear, no score.
- PvP matches don't use this; they show the winner and Elo change in `PvPHeader`.
