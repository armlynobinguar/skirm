# Tabs

Switches between views of the same screen (Skills / Owned / Listed, Run / Replay).

- **Provide:** `tabs` (`[{ id, label, count?, icon?, disabled? }]`), `value` + `onChange` (controlled) or `defaultValue`, and an accessible `label`.
- Arrow keys, Home and End move between tabs (roving tab index). The selected tab gets a 3px `chalk` bar.
- Use `count` for list sizes in mono. Keep labels to one or two words.
- Don't use tabs for steps in a flow or for filters that combine; use chips for filters.
