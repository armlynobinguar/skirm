# LeaderboardRow

One line of a map leaderboard: rank, player, crew size, steps, score and percentile.

- **Provide:** `row` (`{ rank, player, agents, steps, score }`), optional `you`, `percentile` (0 to 100, shown as a marker on a strip).
- Crew size shows as small agent avatars so "1 agent" runs stand out; fewer agents is the game's mastery signal.
- The viewer's row gets `chalk-soft` and a `you` badge. Keep it visible: pin it under the top rows when it is further down.
- Below 520px the crew and percentile columns drop.
