# Automatic decisions

Steward can now decide on its own. The owner saves one stock plan (symbol and amount); during market hours the background worker checks that plan against the saved mandate every 30 minutes and records a normal decision receipt each time — no prompt, no typed proposal. Every decision is visible in the broker history with `Steward made this decision automatically from your saved plan.` provenance.

## What the agent does

- Reads the account and a fresh IEX quote through the same read-only Alpaca adapter as a manual check.
- Runs the identical six-limit decision (`lib/decision.ts` `evaluateBuy`) and saves the identical `DecisionReceipt`.
- Holds (records a "held" receipt) whenever any limit fails. A held decision is a completed decision, not an error.
- At most one decision per 30 minutes and at most 8 per UTC day, per owner. Closed markets are a quiet skip.

## What the agent submits

Automatic **order submission** is paper-only and needs every gate at once:

| Gate | Where |
| --- | --- |
| Plan flag "Also submit passing orders automatically" | `agent_plans.submit_on_paper` |
| Saved action preference "Automatic within limits" | `mandate.executionPreference === "automatic"` |
| Paper environment (hard gate — never live) | `lib/agent-decision.ts` `canAutoSubmit` |
| Trading permission on the connection | `broker_connections.trading_scope` |
| Order submission switch matches the environment | `alpacaOrderSubmissionEnabled` |

When all gates pass, the agent runs the exact same one-attempt pipeline as a manual approval (`lib/order-flow.ts` `approveAndSubmit` with `authorizedBy: "steward_agent"`): the authorization event is recorded honestly as the steward agent's action under the saved automatic preference — it is never recorded as a per-order owner click. The one-attempt claim, fresh broker recheck, exact-order matching, `submission_unknown` on ambiguity and the never-retry rule all apply unchanged.

**A live (real-money) account can never be auto-submitted to.** The environment check is a hard gate; tests pin it. Live orders remain approval-per-owner forever in this release.

## Failure behavior

- Market closed or evidence unavailable: no decision is recorded, nothing is spent.
- Mandate drift (symbol or amount no longer allowed): the run is skipped until the owner updates the plan.
- Broker submission ambiguous: `submission_unknown` is recorded and never retried; the one-attempt gate stays reserved until reconciliation.
- Stopping the plan (or editing it) resets its decision clock; counters reset on plan changes.

## Code map

- `lib/agent-decision.ts` — plan validation, cadence, gates, decision + submission orchestration (pure of Alpaca clients).
- `lib/agent-worker.ts` — worker wiring: loads due plans, builds readers/gateways, tallies a summary on each tick.
- `db/agent-plans.ts` + `agent_plans` table — per-owner plan state.
- `app/api/workspace/agent/route.ts` — GET/POST the plan (owner-authenticated, origin-checked).
- `app/workspace/broker-panel.tsx` — the "Automatic decisions" block and order-event-aware history.

Tests: `node --experimental-strip-types --test lib/agent-decision.test.ts db/agent-plans.test.ts`.
