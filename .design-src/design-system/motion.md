# Motion

The engine is deterministic and runs in ticks (1 to 2 seconds in PvP; any speed in replays). Motion exists to show what changed between two ticks, then get out of the way before the next one.

## The budget

- Every board animation finishes inside **40% of a tick**. With 1 s PvP ticks that is 400ms; at a 4× replay of 1 s ticks it is 100ms. Compute `min(token, tickMs × 0.4)` and set it on the board.
- Nothing on the board moves unless the engine changed it, except the ambient loops below.
- Numbers (tick, credits, timer) change instantly. Meters (`RunHUD`, `ConfidenceBar`) ease their width in `duration-step`.

## Tick animations

| Event | Motion | Tokens |
| --- | --- | --- |
| Agent moves one tile | Slides from cell to cell | `duration-step`, `ease-step` |
| Agent pushes a crate | Crate tile changes cell (no slide in v0); agent slides | `duration-step` |
| Hazard spreads into a tile | New tile grows from the edge it entered from (scale from 15%, opacity from 40%) | `duration-spread`, `ease-spread` |
| Block placed, dirt dug, gem picked up | Tile swaps on the tick, no animation | none |
| Agent lost | Body greys and X face shows for one tick | 400ms fade |
| Decision probabilities update | Bars ease to new widths | `duration-step` |
| Agent is deciding (PvP) | Avatar ring pulses outward | `duration-loop` |

Spread direction comes from a neighbouring tile of the same hazard: north first, then south, west, east. When several neighbours qualify the result is still deterministic.

## Ambient loops

Water waves drift ±0.75px, lava cracks glow between 70% and 100% opacity, flames flicker in height by 12%, critical-spot brackets pulse between 55% and 100% opacity. All use `duration-loop` (fire uses 640ms). They are small enough not to pull attention from a moving agent.

## UI motion

Toasts and the modal rise 8px and fade in over `duration-base` with `ease-standard`. Hover and press use `duration-fast`. Non-critical toasts leave after `duration-toast`; critical toasts stay until dismissed.

## Reduced motion

Under `prefers-reduced-motion: reduce`, or when `MapGrid` gets `reducedMotion` (offer it as a spectator setting too):

- Ambient loops stop. Water, lava and fire show their static glyphs.
- Agents jump from cell to cell, no slide.
- A newly spread tile appears at 50% opacity for `duration-spread`, then snaps to full. Players still see what is new this tick, without anything growing or moving.
- The avatar pulse, button loading squares, toast and modal entrances stop.
- Nothing about the simulation changes: same ticks, same timing, same information.
