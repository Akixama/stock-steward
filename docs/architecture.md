# Architecture and safety boundaries

## Product flow

Stock Steward saves an owner-bound Mandate with approved stock symbols, a per-purchase limit, a daily buy limit, a position limit and an execution preference. Every save creates a new version. Strategy describes when to act; Mandate remains the higher authority. Practice evaluates the same strategy shapes with fake funds and saves its results in Trail.

The current real-order path runs on Robinhood Chain mainnet 4663. A connected EVM wallet signs a short ownership message, reviews a bounded Safe and Roles permission, approves installation, funds the resulting wallet with USDG and approves each exact purchase transaction. Connecting or signing ownership alone grants no spending authority.

## Permission and execution

The compiled permission limits the owner wallet, module, target, approved stock-token outputs, fixed USDG input, route parameters, output floor, daily call quota, total quota and expiry. Owner revocation removes membership and blocks new orders while leaving balances in the wallet. The isolated contract lab uses pinned Safe, Zodiac Roles, router, Permit2 and PoolManager runtimes with fixture assets.

The order path prepares one short-lived candidate, records a durable intent, asks the wallet to submit it once and keeps an uncertain result reserved until exact chain evidence resolves it. It never interprets outer transaction success as proof of a stock-token fill. Canonical transaction, receipt, header, calldata, code and token-transfer evidence must match the saved intent.

The decision and order-event models preserve held decisions, authorization, one attempt, uncertain responses, inclusion, transfer proof and terminal outcomes. `lib/decision.ts`, `lib/broker-boundary.ts` and `db/ledger.ts` remain provider-neutral historical foundations. The retired Alpaca implementation is documented in `docs/alpaca-separation-inventory.md`.

## Read-only systems

Wallet observations pin supported balances and asset metadata to one canonical block. Failed reads never imply zero. Stock-token valuation uses official underlying quotes and shares-per-token multipliers. Bridge links hand off to external bridge providers; Stock Steward never receives bridge funds.

The optional worker can update Practice, read public wallet state, refresh transaction watches and recover known execution records. Database leases, stable retry identities and revision fences prevent overlap and discard paused results. Three failed observation reads pause a schedule. The worker receives no owner wallet key.

## Automatic trading foundation

The repository contains a separate session signer, transaction journal, accounting, fee, strategy and review foundation for all 12 strategy kinds. Automatic stages are separate default-off runtime gates. This branch's release config stages Shadow receipts only; approval proposals and automatic buys remain off. The automatic-buy setup routes and workspace controls are restored but remain hidden and gated while `AUTO_BUY=false`. The path additionally requires owner session authority, verified provider access for news strategies, independent reviews, operator delivery, a fresh owner-signed Start action and funded buy/revoke rehearsals. Uncertain broadcasts are never automatically retried.

## Data and guide contract

Owner records live in D1. Old Alpaca tables and migrations remain for audit and data-request handling; they are not used by the Robinhood Chain UI. The privacy and data-request documents describe manual deletion handling and retained financial records.

When the Mandate form, `lib/decision.ts`, a provider adapter, receipt persistence or execution behavior changes, update `lib/product-guide.ts` and the matching `/guide` chapter in the same change.
