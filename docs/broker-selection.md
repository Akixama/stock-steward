# Broker connection decision — international audience

Reviewed 24 September 2026. Stock Steward is intended for eligible people in multiple countries, initially for US-listed stocks with USD purchase limits. This is an integration decision record, not confirmation that any broker supports every country.

## Current decision

Keep the receipt and mandate engine independent of any broker. A person can connect only where both the brokerage account and Stock Steward's integration are permitted. The first live path uses owner approval for each order. A stored automatic preference does not enable execution.

**Alpaca Connect is the selected first integration path.** The read-only OAuth consent flow, encrypted token storage, account reader, and receipt check are implemented in code. Country eligibility and funding routes must be checked with Alpaca for each intended market. Live trading for other users requires app approval. The hosted Cloudflare deployment has server-side credentials and a connected paper account; the credentials and token are not in this checkout.

Complete in this order: register an Alpaca Connect app and configure its secrets; test read-only OAuth and broker evidence with an eligible account; add explicit per-order authorization; obtain trading approval and scope; submit an exact order with idempotency and reconcile broker-confirmed outcomes. Keep order submission disabled until app approval, authorization, and a funded eligible account have validated the flow. Do not use an unverified or manually entered account snapshot to create a real receipt.

**Bamboo is a possible partner route, not the default consumer connection.** Bamboo publishes APIs for investment apps serving African users, but describes a fintech or institutional partner setup. It does not establish that Stock Steward can connect an ordinary user's existing Bamboo account. Explore it only if a partner relationship and target market make it relevant.

**Test access is a separate question.** Use a consenting eligible account owner in a supported country to verify the integration. If a planned market is unavailable, use a supported broker or leave that market disabled. Do not route around geographic restrictions.

## Launch eligibility matrix

Track each proposed country and broker pair before enabling a connect button for its residents. Leave an unverified pair unavailable in the product.

| Check | Evidence needed |
| --- | --- |
| Account eligibility | Broker confirms the resident may open or hold the required account |
| Funding and withdrawals | Supported methods, currencies, fees, and limits for that resident |
| Read access | App registration and consent scopes for positions, balances, quotes, open orders, and fills |
| Trading access | App approval, owner consent, order types, and any regional limits |
| Live verification | Eligible consenting account owner tests the full read, approve, submit, and reconcile path |

## Official sources

- Alpaca OAuth app rules: https://docs.alpaca.markets/us/docs/about-connect-api
- Alpaca OAuth scopes and consent flow: https://docs.alpaca.markets/us/docs/using-oauth2-and-trading-api
- Alpaca country guidance: https://alpaca.markets/support/countries-alpaca-is-available
- Bamboo API introduction: https://docs.investbamboo.com/docs/intro/
- Robinhood US account requirements: https://robinhood.com/us/en/support/articles/what-you-need-to-get-started/
