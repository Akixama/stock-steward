# Alpaca separation inventory

## Moved to `archive/alpaca/`

- Alpaca OAuth start, callback and disconnect handlers.
- The old account, broker check, paper agent, broker approval, broker reconciliation and order refresh APIs.
- The broker panel and its connection UI.
- Connection encryption, HTTP, account reader, account view, order gateway, approval plan, paper agent and broker order orchestration code.
- Their unit tests, setup notes, submission notes and screenshots.

## Shared code retained in the product

- `lib/decision.ts`: mandate evaluation and receipt model used beyond Alpaca.
- `lib/broker-boundary.ts`: provider-neutral read interface and decision boundary.
- `db/ledger.ts`: mandate and receipt persistence shared by historical records.
- Existing decision and order-event database records: retained for audit and data-request handling.
- `lib/live-news.ts`: an Alpaca News transport still imported by the disabled autonomous strategy runtime. It remains blocked without verified credentials and access.

## Database artifacts intentionally unchanged

- `broker_connections`
- `account_order_gates`
- `agent_plans`
- `order_events` and historical decision receipts
- Migrations `0001`, `0002`, `0003`, `0016` and their snapshots

Removing or rewriting these would alter stored data and migration history. A later data-retention decision can address them separately.
