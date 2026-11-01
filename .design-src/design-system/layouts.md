# Screens and layout

Starting layouts for the MVP screens, so screens built from this system share one structure. All *proposed*.

## Solo run and replay

- The board is the centre of the screen, at `tile-size-lg` (32px) on desktop, `tile-size-md` (24px) on laptops, `tile-size-sm` (16px) on phones.
- `RunHUD` sits directly above the board, full board width. `ConfidenceBar` sits to the right of the board on desktop (one per agent, stacked) and below it on phones.
- A replay adds `ReplayScrubber` directly under the board. The live run has no scrubber, only the HUD.
- The compact `TileLegend` filtered to the map's things sits under the board.
- When the run ends, `ScoreBreakdown` replaces the confidence bars, with `ScoreHistogram` under it.

## PvP Race split screen

- `PvPHeader` spans the full width at the top: crew A on the left, crew B on the right, clock in the middle. The clock is capped at 10:00 and turns `warning` in the last minute.
- Below it, the two mirrored boards side by side at `tile-size-sm` or larger, crew A's board on the left. Under each board, that crew's `ConfidenceBar` for its first agent.
- Under 600px wide, stack the boards (A above B) and keep the header sticky.
- Spectators see the critical-spot overlay; players in the match do not (*proposed*).

## Crew builder

- Map summary (`MapCard` or the map name and its tags) on the left, crew slots in a row on the right: filled `CrewSlot`s then one empty slot.
- Below the slots, the skills the player owns as `SkillCard`s, filtered to skills whose `handles_tags` overlap the map's tags. Pass the map's unlocks as `mapUnlocks` so unusable skills say so before a run.
- The primary button names the crew size and the hold: "Deploy 1 agent · holds 60 credits".

## Marketplace

- `Tabs` at the top (Skills, Owned, Listed), a search `TextField`, then `SkillCard`s in a grid with `space-6` gaps, `min 300px` columns.
- `CreditsBalance` sits in the top bar on every screen; "Top up" opens `TopUpPanel` in a `Modal`.

## Leaderboard

- `ScoreHistogram` for the map at the top, with the viewer's score marked, then `LeaderboardRow`s. Keep the viewer's row visible: pin it under the top 10 when it is further down.
