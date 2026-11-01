# Toast

A short message about something that just happened in a run, a match or a payment.

- **Provide:** `tone` (`neutral`, `good`, `warning`, `critical`), `title`, optional children (one line of detail), `icon` (overrides the tone icon), `action` (one small `Button`), `onClose`.
- Title is the fact, detail is the number or the next step: "Agent lost to lava" / "Tick 24, tile (10,5)."
- Neutral and good toasts leave after `duration-toast`. Critical toasts stay until dismissed and use `role="alert"`.
- Stack at most three, bottom right on desktop, top on phones. Never cover the board.
- The tone shows as a tinted icon tile, never as a coloured edge or a full-colour background.
