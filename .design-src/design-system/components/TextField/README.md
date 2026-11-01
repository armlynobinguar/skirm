# TextField

Labelled text input, also used multiline for the skill editor.

- **Provide:** `label`, optional `hint` or `error` (string), `prefix` (an `Icon` name or a node), `suffix` (a unit such as `NEAR` or `%`), `multiline`, `mono` (for prices, amounts and coordinates), and normal input props (`value`, `onChange`, `placeholder`...).
- Always show a label; placeholders are examples, not labels.
- Errors say what is allowed: "Royalty must be 0 to 10%." They replace the hint and use the `critical` icon.
- Put units in `suffix`, not in the value. Use `mono` for anything numeric.
- The field is `surface-sunken` with a `line-strong` edge and takes the `focus-ring` on focus.
