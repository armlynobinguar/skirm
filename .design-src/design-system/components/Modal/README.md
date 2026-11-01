# Modal

Interrupts for a decision that spends credits, NEAR or score.

- **Provide:** `open`, `title`, children (body), `footer` (buttons, primary last), `onClose`, optional `size="lg"`. `inline` renders in place without a fixed scrim (for previews and docs).
- Escape and a scrim click close it; focus moves into the dialog and returns afterwards.
- Use it to confirm crew size before a run, top up credits, buy or list a skill. Say the cost and what comes back in the body.
- One modal at a time. Don't use modals for errors that a toast or an inline message can carry.
