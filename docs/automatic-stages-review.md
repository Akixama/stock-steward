# Automatic strategy stages — review build

This branch has **not been deployed**. The runtime defaults for `SHADOW_MODE`, `APPROVE_BY_NOTIFICATION`, and `AUTO_BUY` are all false. The release config stages only `SHADOW_MODE=true`; the other two remain false. Production keeps its current configuration until a separately approved deployment applies this release config and migration `0036`.

Migration `0036` pauses any old archived Shadow plan. The owner must explicitly start it again in Strategy; turning on the release flag alone will not resume an old plan.

## What each flag does

- `SHADOW_MODE`: the existing 15-minute worker evaluates a saved plan against current market and account evidence, then stores an owner-scoped receipt. It cannot load a signer or submit an order. Missing evidence produces a held receipt. The Strategy view can save, start and pause the plan and download receipts.
- `APPROVE_BY_NOTIFICATION`: requires Shadow. A passing **buy** decision saves one proposal and queues a device push. The proposal opens the existing Buy flow for a **fresh** quote and the owner's exact-order wallet signature; it never signs or sends automatically. Without a device subscription, the proposal remains visible in Strategy.
- `AUTO_BUY`: requires Shadow and conflicts with the notification stage. Only buy rules can reach the existing journaled session executor. Defaults are $1 per order and $2 per UTC day, each hard-capped at $5. Saved mandate caps can only lower these numbers. The runtime and D1 trading pause are checked before signer access and before broadcast. An action alert and at least one device delivery are stored before signer access; a result alert and exact hash follow. Unknown outcomes keep the budget and account lock; there is no automatic resend. Push delivery is retried separately; a notification service outage can delay delivery and is a remaining release risk.

## Still required before an autonomous release

The current product has **no live session-grant setup UI or routes**. AUTO_BUY cannot operate for a new user until those archived controls are deliberately restored and reviewed. It also requires a verified owner session grant, fee consent, explicit owner activation, independent security and eligibility release evidence, funded rehearsal evidence, valid two-day permission window, current Permit2 approvals, and a funded session signer. These gates intentionally block execution when absent. The two-day renewal remains a manual wallet action. A server pause prevents new sends but cannot cancel a transaction already broadcast or revoke onchain roles by itself.

The release config is `config/automatic-stages-release.json`; `scripts/audit-deploy-config.mjs` copies it into the Worker build. Review both the migration and release config before any deployment. To stop future automatic actions, set `STEWARD_TRADING_KILL_SWITCH=true` on the Worker and separately pause or revoke the onchain permission from the owner wallet.
