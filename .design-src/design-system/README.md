Promptlings is a grid puzzle where players coach AI agents and then watch them play. This system is built around that split: **the interface is chalk on slate, and colour belongs to the world.** Chrome (buttons, panels, text) stays in two neutrals so that the only saturated things on screen are tiles, hazards and run states. When something on screen is coloured, it means something in the simulation.

Values marked *proposed* are new in this system and not in the concept doc yet. Change them freely.

## Principles

1. **Colour is information.** Use a hue only for a tile, a semantic state (`good`, `warning`, `critical`) or a PvP crew (`crew-a`, `crew-b`). Never use a tile colour as decoration on chrome.
2. **Never colour alone.** Every tile has a glyph or pattern. Every state has an icon or a word. Every crew has a letter. A player with any common colour-vision type, or a greyscale screenshot, must read the board.
3. **The player's things are chalk.** `chalk` marks what belongs to the viewer: the primary button, the selected tab, your row on a leaderboard, your bar in a histogram, your agents (the chalk circle on the board).
4. **The board is the referee.** Everything around a board (HUD, confidence bar, scrubber) reports engine facts in mono numerals. No hype, no animation that the engine did not cause.
5. **Tiles are square, agents are round.** Corners stay at `radius-0` to `radius-3`. `radius-full` is only for agents and agent avatars, so a round shape always means "an agent".

## Dark first

The game is dark-first. Slate (`dark`) is the first theme and the fallback; Paper (`light`) is the second.

- The core screen is a live board that people watch for minutes at a time, including PvP spectators. Saturated tiles on a dark ground stay legible at 16px, and spread animation reads as light moving on dark.
- Hazards (`tile-water`, `tile-lava`, `tile-fire`) are mid-to-high lightness. On a light ground they would lose half their contrast range.
- Paper exists for the marketplace, skill editor and long reading, and for screenshots in docs and the X post.
- **The board itself never changes with the theme.** All `tile-*` tokens have the same value in both themes, and a board always sits in a `surface-sunken` frame. Players learn one palette, and a thumbnail looks the same in a light marketplace card as in the dark run view.

## Voice

Promptlings talks like a referee who is also your coach: short, plain, active, and exact about numbers.

- **Lead with the verb or the fact.** "Seal the spillway first, then collect." "Agent lost to lava." Not "Oops! Looks like your agent had an accident."
- **Use the engine's words.** Tags and actions appear exactly as the engine names them, in mono: `spreads`, `place_block`. Unlock names are capitalised words: Builder, Digger, Firefighter.
- **Give the number.** "5 steps left", "Score 2,325", "Clears 9 of 10 `spreads` maps", "Holds 120 credits". Thousands get a comma. Probabilities get two decimals (0.82).
- **Second person for the player, third for agents.** "Your agent is writing a new plan." The agent never speaks in first person, and its plan or reasoning text is never shown (skill prompts stay secret; replays show actions only).
- **Sentence case** for buttons, titles and labels. Buttons name the action and its cost when there is one: "Deploy 2 agents", "Top up 5 NEAR", "Play · 0.2 NEAR".
- **No exclamation marks, no emoji, no crypto slang.** Say "skill" and "buy", not "NFT" and "mint", in player-facing copy (pillar 5: players never notice the chain). Wallet words appear only on wallet screens.
- **One exception: "Mint skill".** It is allowed as the label of the skill editor's publish action, because the UI/UX spec uses it. Use it only there; everywhere else a minted skill is just a skill that is "listed" or "owned".
- **Failure is plain and useful.** Say what happened and what comes back: "No clear, no score. Credits for unused steps come back."

| Situation | Write | Not |
| --- | --- | --- |
| Run cleared | Map cleared in 27 steps | Amazing run! |
| Agent removed | Agent lost to lava · T 24 | Your agent died :( |
| Skill not usable | Needs Builder. This map does not offer it. | Incompatible NFT |
| Timeout in PvP | Missed time limit, waited | Agent was too slow |
| Planner runs | Replanning: a wall broke | Thinking... |
| Low balance | 38 credits. A run here holds 60. | Insufficient funds |

## Colour

All colours are tokens. Text tokens hold 4.5:1 on every surface their note names, in both themes; borders, icons and the focus ring hold 3:1.

- **Grounds.** `bg` for the page, `surface` for panels and cards, `surface-raised` for anything floating, `surface-sunken` for wells (inputs, bar tracks, the board frame). Separate rows with `line`; edge controls with `line-strong`.
- **Text.** `ink` for primary text, `ink-muted` for labels, units and metadata, `ink-faint` for placeholders and axis ticks only.
- **Player.** `chalk` fill with `on-chalk` text for the one primary action per view and for "you" highlights. `chalk-soft` for hover and selected rows.
- **States.** `good` (cyan, not green), `warning` (amber), `critical` (red), each with a `-soft` background and an `on-` token for solid fills. `good` sits off the red–green axis so it never depends on hue against `critical`. Always pair with the check, triangle or octagon icon, or a word.
- **Crews.** `crew-a` (blue) and `crew-b` (orange) only in PvP, always with the letter A or B. Blue against orange separates for protanopia, deuteranopia and tritanopia.
- **Focus.** `focus` pink, drawn by the `focus-ring` shadow: 2px of `bg`, then 2px of `focus`. Every interactive element uses it; never remove it.

## Tile palette

One token per thing in the tags table, plus a `-mark` token for its glyph. Full renderer rules are in the Tiles and the board section.

| Thing | Fill token | Glyph (in `-mark` token) | Tags | Map char |
| --- | --- | --- | --- | --- |
| Floor | `tile-floor` | hairline cell in `tile-grid` | none | `.` |
| Stone wall | `tile-wall` | brick joints | `solid` `blocks` | `#` |
| Water | `tile-water` | two waves, drifting | `spreads` `liquid` | `~` |
| Lava | `tile-lava` | glowing crack | `spreads` `liquid` `damages` | `L` |
| Fire | `tile-fire` | dark flame, flickering | `spreads` `damages` | `^` |
| Grass | `tile-grass` | three tufts | `flammable` | `,` |
| Wooden crate | `tile-crate` | frame and X brace | `solid` `pushable` `flammable` | `c` |
| Dirt | `tile-dirt` | stipple | `solid` `blocks` `breakable` | `d` |
| Placed block | `tile-block` | inset frame and plus | `solid` `blocks` | `=` *proposed* |
| Gem, key, crystal | `tile-gem` | faceted diamond on floor | `collectible` | `*` |
| Exit | `tile-exit` | dark door arch | `goal` | `E` |
| Agent | `tile-agent` | chalk circle, `>_` face | entity | `0` (start) |
| Critical spot | `tile-mark` | pink corner brackets over `tile-mark-halo` | overlay | none |

Rules that keep the palette readable for colour-blind players:

- Hazards are separated by lightness, not hue: `tile-fire` is the lightest hazard, `tile-water` is mid, `tile-lava` is the darkest. Fire and lava never look alike, even in greyscale.
- `tile-crate` is far lighter than `tile-grass`, because they sit next to each other on the Ember Warehouse fuel line and look alike under protanopia otherwise.
- Under simulated protanopia, deuteranopia and tritanopia every pair of tile fills stays at least ΔE 10 apart. Every glyph holds 3:1 or more on its own fill, so glyphs carry identity on their own. The one exception is the wall's brick joints (1.8:1), which are only texture: walls are the most common tile, so they stay quiet and read by their fill against `tile-floor` (2.6:1).
- `tile-mark` brackets always draw over a `tile-mark-halo` stroke, so they read on light tiles (crate, block) as well as dark ones.
- Show the critical-spot highlight in replays, the spectator view and the map editor. Do not show it on a map before a run: finding the dam spot is the puzzle (*proposed*).

## Type

Three Google Fonts families. Set every number that changes during a run in mono with tabular figures so digits do not jump between ticks.

- **Display** (`display`, Pixelify Sans): letters built on a pixel grid, echoing the boards. Use `display-xl` for the final score, `display-lg` for page titles and map names, `display-md` for section and modal titles. Never below 24px, never for running text.
- **Text** (`sans`, Atkinson Hyperlegible Next, falling back to Atkinson Hyperlegible): designed for low-vision readers, with distinct 1, l, I and 0, O. Use `title` for card titles, `body` for running text, `label` for buttons, tabs and field labels, `small` for metadata.
- **Mono** (`mono`, Atkinson Hyperlegible Mono): `hud` for run counters and balances, `mono` for tags, actions, Elo and prices, `mono-sm` for probabilities, axis labels and legend characters. `mono-sm` (11px) is the floor for any text.

## Space, size and shape

- Spacing is a 4px scale: `space-1` (4) to `space-12` (48). Pad cards with `space-4`, gap cards with `space-6`, separate page sections with `space-8`. Use `space-4` as the side gutter on phones.
- Board tiles use their own scale, `tileSize`: `tile-size-xs` 8px (thumbnails), `tile-size-sm` 16px (smallest live board), `tile-size-md` 24px (default), `tile-size-lg` 32px, `tile-size-xl` 48px (legend, tutorials). A 15 × 9 map at 24px is 360 × 216px; at 16px it is 240 × 144px, which fits two boards side by side on a 600px-wide split screen.
- Radius: `radius-0` tiles, `radius-1` chips and bars, `radius-2` buttons, inputs and toasts, `radius-3` cards and the modal, `radius-full` agents only.
- Elevation: `elev-1` cards at rest, `elev-2` toasts, menus and hover lift, `elev-3` the modal. In Slate the 1px edge inside each shadow does most of the work.

## Motion

Board motion follows the engine's tick and never runs ahead of it. Details and reduced-motion behaviour are in the Motion section.

- An agent step slides one tile in `duration-step` with `ease-step`. A hazard entering a tile grows in from the side it came from in `duration-spread` with `ease-spread`.
- Ambient loops (water drift, lava glow, fire flicker, mark pulse) use `duration-loop` and move a fraction of a pixel. They stop entirely under reduced motion.
- All board motion must finish inside 40% of a tick. At fast replay speeds use `min(token, tick × 0.4)`.

## Iconography

- One stroke icon set, drawn for this game on a 16-unit grid with a 1.5 stroke and round caps and joins. Use it through the `Icon` component so icons take `currentColor`. Size 16 by default, 12 to 13 inside chips, 20 in the run HUD.
- **Action icons** match the engine's seven actions (`move`, `wait`, `pick_up`, `drop`, `place_block`, `dig`, `extinguish`). Unlocks reuse their action's icon: Builder is `place_block`, Digger is `dig`, Firefighter is `extinguish`.
- **Tag icons** (`tag_spreads` ... `tag_goal`) appear in tag chips and clear-rate rows, never alone: always beside the tag word.
- **The `>_` face** is the game's motif: the agent is a chalk circle with a prompt for a face, and the skill icon is the same prompt in a square. Do not use robot, brain or sparkle imagery for AI.
- **Tile glyphs are not icons.** They live in the board renderer and the Tiles asset group. Do not put tile glyphs on buttons.
- No emoji anywhere in the UI.
- The SVG files in the Icons group are single-ink exports in `#7a817c` (3:1 or better on both `bg` values) for design tools and docs. In the product, use the `Icon` component instead.

## Logo

- `promptlings-mark.svg` is the mark: an agent on a slate tile with one pink corner bracket. It carries its own slate ground, so it works on either theme. Minimum size 16px.
- The wordmark is tile-built: PROMPTLINGS on a 5 × 7 pixel grid, with the O replaced by an agent. Use `promptlings-wordmark-dark.svg` on Slate and `promptlings-wordmark-light.svg` on Paper. Minimum height 14px.
- In product UI, `Logo` sets the name in the display face beside the mark, which follows the theme's `ink`.
- The name is tentative. If it changes, the mark survives; the wordmark is regenerated from the same pixel grid.

## Components

React 18 components, all in `window.Promptlings` (see Consuming in code below). Each has a live preview and guidelines.

- **Controls:** Button, TextField, Tabs, Toast, Modal.
- **Status:** Badge, TagChip, UnlockChip, ScopeChip.
- **Agents and crew:** AgentAvatar, AgentChip, CrewSlot.
- **Marketplace and credits:** SkillCard, CreditsBalance, TopUpPanel.
- **Board:** MapGrid (tile renderer), TileLegend, MapCard.
- **Run and replay:** RunHUD, ConfidenceBar, ReplayScrubber, ScoreBreakdown.
- **Leaderboards:** ScoreHistogram, LeaderboardRow.
- **PvP:** PvPHeader.
- **Brand:** Logo, Icon.

The bundle also exports engine vocabulary as data: `TAGS`, `TAG_MEANING`, `ACTIONS`, `UNLOCKS`, `TILES`, `MAPS` (the three v0 maps with grids, goals and step limits), and `scoreRun()` / `multiplierFor()`, which implement the concept doc's score formula. `scoreRun()` rounds half up (`Math.floor(x + 0.5)`) and charges `UPKEEP_PER_SKILL` (25 points) per equipped skill unless you pass a total `upkeep`. Without upkeep it gives the canonical map scores: Flood Gate 2,325 solo / 1,213 with two agents, Ember Warehouse 2,130 / 1,065, Magma Mine 1,779 / 1,157.

## States

- **Hover:** `chalk-soft` background. **Pressed:** 1px down. **Focus:** `focus-ring`. **Disabled:** 50% opacity plus a reason in words nearby ("Needs Builder").
- **Loading:** three small squares lighting in tick order (`Button` with `loading`). Never a spinner.
- **Empty:** dashed `line-strong` border and one line of copy that names the next action ("Add agent 2").

## Consuming in code

Three files make up the system at runtime, loaded in this order: `tokens.css` (every token as a CSS variable, both themes, the type-style classes and the Google Fonts imports), `components/bundle.css` (component styles; it reads only those variables), then React 18 and `components/bundle.js`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/promptlings/tokens.css">
<link rel="stylesheet" href="/promptlings/bundle.css">
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="/promptlings/bundle.js"></script>
```

- **Fonts.** `tokens.css` and `bundle.css` both `@import` the Google Fonts, so the `<link>` tags are only there to start the download earlier. In Next.js you can load the same three families with `next/font/google` instead and drop the imports.
- **Globals.** `bundle.js` is one classic script. It reads `window.React` and `window.ReactDOM` and assigns `window.Promptlings`, which holds every component (`Promptlings.Button`, `Promptlings.MapGrid`, ...) plus data and helpers: `TAGS`, `TAG_MEANING`, `ACTIONS`, `UNLOCKS`, `TILES`, `MAPS`, `ICONS`, `multiplierFor()`, `scoreRun()`, `UPKEEP_PER_SKILL`. Types are in `components/index.d.ts`.
- **Next.js.** Copy the three files into `public/promptlings/`. Import `tokens.css` and `bundle.css` from the root layout, load `bundle.js` with `next/script` (`strategy="beforeInteractive"`) after React's UMD build, and read components from `window.Promptlings` inside client components. Or port the components to TSX, since the bundle has no build step and every class is prefixed `pl-`.
- **Use variables, not hex.** Write `var(--surface)`, `var(--tile-water)`, `var(--space-4)`, `var(--font-mono)`, `box-shadow: var(--elev-1)`. Never paste a hex value from this book into app CSS.
- **Type classes.** `tokens.css` defines one class per type style: `.display-xl`, `.display-lg`, `.display-md`, `.title`, `.body`, `.label`, `.small`, `.hud`, `.mono`, `.mono-sm`. The names are short, so if your app already uses `.title` or `.label`, load `tokens.css` in a lower `@layer` or apply the same declarations through your own classes.
- **Theme switching.** Slate is the default: with no attribute, `:root` gets the dark values. Set the theme on `<html>`:
  - `data-theme="dark"`: Slate.
  - `data-theme="light"`: Paper.
  - `data-theme="system"`: follows the OS through `prefers-color-scheme`, and stays on Slate when the OS has no preference.

  Store the player's choice (Slate, Paper or System) and set the attribute before first paint, so the page never flashes the wrong theme. Tile tokens are the same in every theme, so boards never change.
- **Reduced motion.** `bundle.css` honours `prefers-reduced-motion`. Pass `reducedMotion` to `MapGrid` to apply the same behaviour from an in-game setting.

