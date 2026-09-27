# Strategies and practice

The workspace Strategy tab supports four reviewed, buy-only strategy kinds: scheduled buying, price thresholds, target allocation and cautious accumulation. Approval is the default; automatic practice must be explicitly selected and separately authorized. Strategy versions and saved mandate versions are recorded in each receipt.

`lib/strategy.ts` is a deterministic strategy evaluator with integer cents and basis points. It checks triggers, permission, fresh simulated quotes, allowlist, purchase cap, UTC daily budget, reserve, concentration and target overshoot. `practiceFill` re-evaluates the exact proposal against current evidence, strategy and mandate before updating balances. Changed evidence, revoked permission and replayed approvals cannot fill.

Practice is a browser-local simulation with $1,000 fake cash and editable fixture prices. It sends no wallet, broker or blockchain transaction. The eight-second agent loop runs while the workspace is open, using an explicitly simulated clock. Advance that clock to test schedules and daily reset. Pause stops the loop; revoke also invalidates pending approvals. Changing the saved mandate or confirming a replacement strategy revokes practice permission.

Only the confirmed strategy persists on this browser. Balances, grants and receipts are page-session state. Export receipts before reloading. Practice receipts are kept separate from server-side live evidence. They never contain invented transaction hashes or chain-confirmation claims.

Directions can be interpreted by an optional browser-local WebLLM model, with no paid API account. The first explicit load downloads several hundred MB and requires WebGPU and sufficient GPU memory. Missing or unsupported rules need clarification. Applying an AI draft never confirms or authorizes it; only separately reviewed structured rules run. Unsupported conditions, news analysis, selling and optimization do not execute. Live mode is unavailable: real authority installation, complete fees, data, accounting and signing still require integration. The engine has no live submission API and practice permission cannot authorize real funds.

The separate permission lab exercises actual wallet, permission and swap runtimes with fixture tokens. This UI simulation is not that contract lab and does not establish a mainnet fill, fee or liquidity guarantee.
