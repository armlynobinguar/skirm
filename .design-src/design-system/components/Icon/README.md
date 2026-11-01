# Icon

Stroke icons on a 16-unit grid, in `currentColor`.

- **Provide:** `name` (see the preview; actions use engine names such as `place_block`, tags use `tag_<tag>`), optional `size` (default 16) and `title` (makes it a labelled image; omit for decorative icons next to text).
- Set colour with CSS `color` on a parent. Icons beside text take the text's token (`ink` or `ink-muted`).
- Always pair a status icon (`check`, `warning`, `critical`) with a word or a `Badge`.
- Don't mix in other icon sets, emoji or filled variants. If an icon is missing, add it to the set on the same grid.
