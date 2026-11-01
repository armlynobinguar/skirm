# Testing before a push

- `.githooks/pre-push` runs typecheck and test (and `cargo test` when `contracts/` changed). Never
  skip it with `--no-verify`. If it fails, fix the cause and push again.
- The full stack smoke is not in CI. Before pushing a big or cross-service change (README, "Full
  stack smoke" lists what counts), run `npm run smoke` if Docker is available, and report the
  result. If Docker isn't available, say that the smoke was not run.
