# Tiles and the board

How to draw a map. `MapGrid` implements all of this; follow these rules when you draw a board anywhere else (a canvas renderer, an OG image, the demo video).

## Layers, bottom to top

1. **Tile layer.** One square per cell, filled with the thing's `tile-*` token and its glyph in the matching `tile-*-mark` token. Liquids and fire draw over `tile-floor`, so a spreading tile can grow in over the floor.
2. **Overlay layer.** Critical-spot brackets (`tile-mark` over `tile-mark-halo`). Replays, spectator view and map editor only.
3. **Entity layer.** Agents, positioned by transform so they can slide between cells. An agent is always drawn above any tile.

Never round a tile (`radius-0`). Never put a gap between tiles: walls must read as continuous masses. The board frame is `surface-sunken` with `space-2` padding and a `radius-1` corner.

## Detail by tile size

| Tile size | Detail | What draws |
| --- | --- | --- |
| 16px and up (`tile-size-sm` to `tile-size-xl`) | full | Fill, full glyph, floor hairline, agent face (`>_`), crew letter at 28px+ |
| 10 to 15px | compact | Fill and a single simplified mark (one wave, one tuft, an X, three dots); wall joints dropped; agent shows two eyes |
| under 10px (`tile-size-xs`) | fill | Fill only, plus shapes for gem (diamond), exit (arch) and agent (circle) |

Pick the largest tile size that fits. The live board's floor is `tile-size-sm` (16px): below that, glyphs become marks and hazards lose their patterns, which is fine for thumbnails but not for a board a player is watching.

## The map character legend (v0)

The grids in `maps-v0.md` use these characters. `MapGrid` takes the grid as an array of strings.

| Char | Thing | Char | Thing |
| --- | --- | --- | --- |
| `#` | Stone wall | `c` | Wooden crate |
| `.` | Floor | `d` | Dirt |
| `~` | Water | `*` | Gem, key or crystal |
| `L` | Lava | `E` | Exit |
| `^` | Fire | `0` | Agent start (drawn as floor plus an agent) |
| `,` | Grass | `=` | Placed block (*proposed*: the v0 grids have no character for it because blocks only appear during a run) |

The map JSON schema is still open. This legend is for drawing and tests, not a commitment to the file format.

## Agents on the board

- Body: a `tile-agent` circle with a `tile-mark-halo` outline. Face: `>_` in `tile-agent-mark`. Circle means agent; nothing else on a board is round.
- PvP: a ring in `crew-a` or `crew-b` around the body, plus the crew letter in a small square at 28px and up. In Race each crew has its own board, so the ring mostly matters in Duel (stretch), where crews share a map.
- Lost agent: body turns `tile-wall` grey with an X face for the tick it was removed, then leaves the board. The HUD count and a `critical` toast say what removed it.
- Two agents moving into one tile both stay put (tick order rule 1). Draw nothing special; the replay log explains it.

## Hazards that cover goals

A hazard covering a goal tile floods it and fails the run. Draw the hazard tile (the exit disappears under water or lava), show a `critical` badge "Goal flooded" in the HUD, and mark the tick with a `lost`-style event in the replay scrubber.

## Legend

Show `TileLegend` beside every board a new player sees, filtered to the things on that map (`kinds`). Use the compact legend under PvP boards. The legend shows the tags each thing carries, because skills are written against tags, not names.

## Assets

The Tiles asset group has every tile glyph as a 64px SVG (16-unit viewBox) in exact token colours, plus crew A and B agents. Use them in docs, decks and design tools. In the product, render tiles with `MapGrid` so they follow detail levels and motion.
