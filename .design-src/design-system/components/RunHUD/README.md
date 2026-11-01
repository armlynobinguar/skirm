# RunHUD

The run's vital signs above the board: tick against the step limit, agents alive, credits spent and held, status.

- **Provide:** `tick`, `stepLimit`, `agentsAlive`, `agentsTotal`, `creditsSpent`, optional `creditsHeld` (agents × step limit, held up front), `status` (`planning`, `running`, `cleared`, `failed`), `failReason`, `speed` (replay speed), `crew`.
- The tick meter turns `warning` with a "N steps left" note at 85% of the step limit (*proposed* threshold).
- Agents alive turns `critical` when any agent is lost; lost agents show as grey X avatars.
- Credits: one credit per agent turn (*proposed* unit). "Unused come back" restates the prepaid rule.
- Numbers are mono with tabular figures; they update instantly each tick.
