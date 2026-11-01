# Button

Buttons start, confirm and spend. One `primary` button per view.

- **Provide:** children (the label), `variant` (`primary`, `secondary` default, `ghost`, `danger`), `size` (`sm`, `md`, `lg`), optional `icon` / `iconRight` (an `Icon` name), `loading`, `disabled`, `block`, and normal button props.
- `primary` is `chalk` on `on-chalk`: use it for the action the screen exists for (Start run, Buy, Deploy). `secondary` for everything else, `ghost` inside toolbars and cards, `danger` only for leaving a match or deleting a listing.
- Labels say the action and, when it costs something, the cost: "Deploy 2 agents", "Top up 5 NEAR".
- `loading` shows three squares lighting in tick order and keeps the button's width. Say what is happening: "Waiting for wallet".
- A disabled button needs a visible reason nearby or as its label ("Needs Builder").
