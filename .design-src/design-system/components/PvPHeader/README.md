# PvPHeader

The top of a live PvP match: both crews, the match clock capped at 10 minutes, the tick, and each side's Elo and progress.

- **Provide:** `crewA` and `crewB` (`{ name, elo, eloDelta?, agents, lost?, progress?, you? }`), `elapsedMs`, optional `capMs` (default 600000, the 10-minute cap), `tick`, `mode` (`Race` default, `Duel`), `ranked` (default true).
- The clock counts down from 10:00 and turns `warning` in the last minute (*proposed* threshold). The meter shows time used.
- Crew A is always left and `crew-a` blue, crew B right and `crew-b` orange, each with its letter. The viewer's crew gets a `you` badge.
- Elo shown is the agent's rating for a 1-agent crew; for bigger crews show the crews' mean agent Elo (*proposed*). After the match, `eloDelta` shows the change.
- `progress` is the map's goal state in mono ("Gems 2/3", "Cleared T 212").
