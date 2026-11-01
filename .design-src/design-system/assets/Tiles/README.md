# Tiles

Full-detail tile glyphs in exact token colours, 64px with a 16-unit viewBox (one tile). One file per thing in the tags table, plus crew agents. Theme-invariant: tiles look the same on Slate and Paper.

- `tile-floor.svg` (`tile-floor`, hairline `tile-grid`), `tile-wall.svg`, `tile-water.svg`, `tile-lava.svg`, `tile-fire.svg`, `tile-grass.svg`, `tile-crate.svg`, `tile-dirt.svg`, `tile-block.svg` (placed block), `tile-gem.svg` (gem, key, crystal), `tile-exit.svg`.
- `tile-agent.svg`: an agent on floor. `tile-agent-crew-a.svg` / `tile-agent-crew-b.svg`: PvP agents with the `crew-a` / `crew-b` ring and letter.
- `tile-mark.svg`: the critical-spot overlay (pink brackets on a dark halo) shown on floor.
- For docs, decks, the demo video and design tools. In the product, draw boards with `MapGrid`, which picks detail by tile size and animates spread.
