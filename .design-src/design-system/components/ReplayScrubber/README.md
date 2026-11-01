# ReplayScrubber

Moves through a recorded run tick by tick, with key events marked on the timeline.

- **Provide:** `total` (ticks in the run), `tick` + `onSeek` (controlled) or `defaultTick`, `playing` + `onPlayToggle`, `speed` + `onSpeed`, optional `speeds` (default 0.5, 1, 2, 4), `events` (`[{ tick, kind, label? }]`, kind one of `spread`, `block`, `collect`, `replan`, `lost`, `goal`).
- Each event kind has its own shape (triangle, square, diamond, ring, X, flag), so the timeline reads without colour. A key under the track lists only the kinds present.
- Keyboard: arrows step one tick, Page Up/Down ten, Home/End to the ends.
- Events come from the replay log. `replan` marks when the planner ran (start, every ~20 turns, or after a big change).
