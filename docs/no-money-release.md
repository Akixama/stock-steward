# No-money release checklist

## Practice walkthrough

1. Save boundaries that allow AAPL, a $1 single purchase, sufficient daily cap and a sensible concentration cap.
2. Open Strategy, choose Practice and enter rules or use the configured free AI to draft them. Review and confirm.
3. Authorize practice, run one check, then approve the exact fake purchase. Cash changes from $1,000 to $999 and holdings gain $1. Reload: balances and receipts remain.
4. Start the agent. Approval mode waits for you; automatic mode buys only within all reviewed boundaries. Optionally enable background practice, which uses fake funds only and may wake later than 15 minutes. Pause stops both foreground and background activity.
5. Expand simulated controls. Try stale quote, no cash, daily limit and position too large; run a check and inspect the held receipt. Restore Normal funds to return to the healthy fixture. Scenario changes pause the agent and invalidate approvals.
6. Change a price or advance the clock: old approvals cannot execute. Scheduled rules use elapsed simulated time; daily limits reset on the simulated UTC day.
7. Export practice receipts. Revoke permission before resetting fake funds. Reset keeps confirmed rules but clears prior fake balances and receipts.

## Background runner verification (8 October 2026)

The read-only monitoring runner is wired and observed against the live Cloudflare deployment. The scheduler worker targets the live tick URL (it previously pointed at the retired chatgpt.site deployment). Verified chain: cron config `*/15 * * * *` deployed, shared key accepted, an active schedule tick processed one observation run (recorded in schedule runs, spendingEnabled false), pause fencing discarded results while paused, and start/pause/resume persisted with revision fencing. The UI `workerConfigured` flag now reads true and the worker health row records started/completed ticks. This is read-only monitoring; no signer or spending exists.

## Deployment polish review (8 October 2026)

Remaining no-money issues were reviewed and closed where missing: new-visitor onboarding (the NEW HERE start path and wallet onboarding with honest planned states) was already present and verified; mobile breakpoints cover the workspace, and the newer broker panel grids and check form now collapse on small screens alongside the decision history; every panel renders visible error states with role="alert" and always fails closed; practice receipts export is present; a Disconnect action was added to the broker panel (confirm step, idempotent route verified live) alongside reconnect through /connect; unsupported wallet providers are labeled Planned rather than broken. Authentication callback recovery was verified in the preceding work. Identity persistence had a real gap found on 8 October 2026: re-submitting the sign-in form minted a fresh identity over a valid session, silently orphaning the workspace. The sign-in route now preserves an existing valid identity (GET redirects signed-in visitors straight to the workspace; POST never replaces a valid session).

## Reproducible verification

All lib and db test files run with Node's experimental transform-types test runner. The isolated actual-router lab runs with:

node --experimental-transform-types permission-lab/test.mjs --actual-router

The lab needs the ignored permission-runtime snapshot captured by the documented read-only script. It uses actual wallet/permission/swap runtime bytecode with fake tokens and fake liquidity, not a real trade.

## Boundaries

Practice is a server-persisted simulation, not a testnet blockchain wallet. No real key, signature, token allowance or funds are used. AI suggestions are drafts; unsupported selling, news triggers or arbitrary instructions cannot execute. Hosted live activation has no submission capability. Mainnet evidence and funded owner approvals remain separate; see execution-preparation.md.
