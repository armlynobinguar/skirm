# MapGrid

The tile renderer: draws a map grid with agents and overlays, and animates spread between ticks.

- **Provide:** `rows` (array of strings in the v0 map characters, see Tiles and the board), `tileSize` (default 24), optional `agents` (`[{ id, x, y, crew?, alive?, letter? }]`; defaults to the `0` start cells), `marks` (`[[x, y]]` critical spots), `detail` (`full`, `compact`, `fill`; defaults by size), `animate` (default true), `reducedMotion`, `label` (accessible summary, e.g. "Flood Gate, tick 14").
- Re-render with the new grid each tick. Tiles that become water, lava or fire grow in from the neighbouring tile of the same hazard; agents slide by `id`.
- Keep agent `id`s stable across ticks so movement animates.
- Show `marks` only in replays, spectator view and the editor.
- Use 16px tiles or larger for any board a player watches. Thumbnails use `tileSize` 8 to 12 with `animate={false}`.
