# Stock Steward

**Status: Under development. One owner-approved Robinhood Chain pilot purchase has been verified; autonomous orders have not.**

Stock Steward is a Robinhood Chain product that lets an owner set stock and spending limits, checks purchases against the exact saved version, and keeps a receipt for every decision. Practice uses fake funds; the released real-order flow asks the owner to approve every transaction in their wallet.

## What works today

- Practice mode with 12 strategies, fake funds, indicative quotes and saved receipts.
- Versioned limits for approved stocks, each purchase, each day and position exposure.
- Read-only Robinhood Chain wallet, stock-token, route and market reads.
- Wallet ownership verification and a bounded, revocable onchain permission.
- Owner-approved real purchases with one-attempt submission and receipt verification.
- One private-pilot purchase verified against finalized chain evidence. See [the verification record](docs/verification-2026-10-10.md).

## What is not live

- Automatic real-money trading. The executor is compiled off and the normal UI hides its setup.
- News-triggered real trades without a verified provider account and entitlement.
- Any route, fee, review or wallet state that the app cannot verify. Missing evidence blocks action.
- The retired Alpaca integration, now preserved under [`archive/alpaca/`](archive/alpaca/README.md).

## Try it

- Open [stocksteward.app](https://stocksteward.app).
- Practice needs no wallet and cannot move real funds.
- The [product guide](https://stocksteward.app/guide) explains limits, strategies, Practice, permissions, orders and receipts.

## Local setup

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm run db:local:apply
npm run dev
```

Run every application and archived-adapter test with `npm test`. See [testing](docs/testing.md) and the [operator runbook](docs/runbook.md) for contract tests, deployment and migration details.

## Product visibility flags

- `SHOW_DEVELOPER_TOOLS=true` shows route inspection, read-only monitoring and transaction watch tools.
- A review branch stages background Shadow receipts, notification proposals and a separately gated tiny automatic-buy path. Production still runs the existing release until this branch is reviewed and deployed. See [the stage review](docs/automatic-stages-review.md).
- `SHOW_DEVELOPER_TOOLS` defaults to `false` and is read at build time.

## Documentation

- [Architecture and safety boundaries](docs/architecture.md)
- [Testing and verification](docs/testing.md)
- [Local and production runbook](docs/runbook.md)
- [Product guide source](app/guide/page.tsx) and the live [`/guide`](https://stocksteward.app/guide)
- [Alpaca separation inventory](docs/alpaca-separation-inventory.md)

When the Mandate form, `lib/decision.ts`, a provider adapter, receipt persistence or execution behavior changes, update `lib/product-guide.ts` and the matching `/guide` chapter in the same change.
