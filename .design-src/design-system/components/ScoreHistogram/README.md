# ScoreHistogram

Where a score sits among everyone else's on a map, as Opus Magnum does.

- **Provide:** `bins` (counts per equal-width score bucket), `min` and `max` (score range of the bins), optional `yourScore`, `caption`, `height` (px, default 64).
- Bars are `ink-faint`; the viewer's bucket is `chalk` with a dashed marker and a "You 2,181" label.
- Use one per map on the leaderboard and the results screen. The axis is score, not rank.
