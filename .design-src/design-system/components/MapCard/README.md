# MapCard

A map in a list: thumbnail, mechanics, goal, step limit, unlocks offered and best scores.

- **Provide:** `map` (`{ name, theme, rows, tags, unlocks, goal, stepLimit, bestSolo: { steps, score } }`; `Promptlings.MAPS` has the three v0 maps), optional `cleared`, `yourBest`, `onPlay`, `entryFee` (NEAR), `thumbSize` (default 12), `maxTags` (default 4).
- The thumbnail is a static `MapGrid` at 8 to 12px.
- The play button names the entry fee when there is one: "Play · 0.2 NEAR" (solo entry fees are decided; the amount is *proposed*).
