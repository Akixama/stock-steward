# Alpaca Connect submission package

The existing Stock Steward Alpaca Connect app showed **Published** on 8 October 2026. Its website, redirect URI, privacy URL, and terms URL were updated to the Cloudflare deployment in Alpaca's editor and verified after Alpaca reported “App Successfully Updated!” A paper-account data grant and account read have since succeeded; this does not prove an executable trading flow.

Alpaca's public app detail still says the app can place trades on a user's behalf. The app editor has no permission control for that statement. Stock Steward requests `scope=data&env=paper` for the initial connection and rejects a `trading` scope returned to that flow; live order submission remains disabled. On 8 October 2026 the paper-account consent page said authorization includes placing transactions “at your direction” despite the `data` request. The account owner accepted that wording. The callback accepted a token with `data` scope and no `trading` scope, and a read-only account refresh succeeded. Do not describe Alpaca's consent screen as read-only.

The first attempt returned `invalid_state` after its ten-minute session expired. The deployed retry now allows 30 minutes and returns a clear retry message when state is missing or replaced. The successful retry saved the token in D1; no token, account ID, or balance is in this document.

The Cloudflare Worker has the Alpaca client ID, client secret, paper environment, exact callback URL, and token encryption key as server-side secrets. The values are not in Git. `ALPACA_ORDER_SUBMISSION_MODE` is unset. The deployed `/connect` button is enabled and generated an authorization URL with the published app ID, registered callback, `scope=data`, and `env=paper`; the separate trading-access button remains disabled.

| Form item | Stock Steward value |
| --- | --- |
| App name | Stock Steward |
| Public website | `https://stocksteward.app/` |
| OAuth redirect | `https://stocksteward.app/api/broker/alpaca/callback` |
| Privacy | `https://stocksteward.app/privacy` |
| Terms | `https://stocksteward.app/terms` |
| Contact | `stocksteward.support@gmail.com` |
| Logo | `docs/alpaca-connect-logo.png` |

## Application description

> Stock Steward is an independent stock-purchase review and order-control project for eligible brokerage account owners. Users save limits on symbols, single buys, daily buys, and position concentration. With their separate Alpaca OAuth consent, the app reads their account, positions, asset status, open orders, fills, and market quotes to check a proposed purchase. It saves a decision receipt showing the observed evidence, each rule result, and why the proposal was held or allowed. The initial connection asks for read access only. Live ordering is disabled in the current deployment. After Alpaca approval and real-account testing, any enabled order would require separate trading permission and the account owner's approval of the exact symbol and amount. Automatic trading and background monitoring are not active.

Disclose any planned commercial use accurately in Alpaca's form. Do not claim Alpaca endorsement or live trading capability. Use the actual operator information that applies to the project in any private application field; the public brand is Stock Steward.

## Customer-facing screenshots

The `docs/alpaca-screenshots/` directory contains captures of the deployed site at 1024 × 500 pixels, checked on 7 October 2026. `/connect` explains read-only consent; `/connect?intent=trading` explains the separate trading permission. Confirm Alpaca's current image requirements before upload.

1. Landing page with the illustrative walkthrough and disconnected-state note.
2. Workspace Overview and Mandate, showing empty broker status and saved-limit controls.
3. Decision Trail, showing an empty state until authenticated broker evidence exists.
4. `/connect` data-scope explanation and `/connect?intent=trading` transaction-access disclosure. The data-scope button is now enabled; the trading-access button remains disabled.
5. `/account`, `/privacy`, and `/terms`, including the data-request path and support contact.

Use the matching files listed in `docs/alpaca-screenshots/README.md`. They show a disposable Practice Demo workspace and no account emails, support IDs, balances, tokens, or other personal data. The form may change; verify its current required pages and dimensions before uploading. The app's published state does not imply a trading approval or account grant.

## After submission

The client ID, client secret, redirect URI, and token encryption key are stored only as Cloudflare Worker secrets. The paper-account `data` grant and an authenticated account/positions/open-orders/clock read succeeded. The market was closed; a fresh quote, fills, and a complete market-hours decision receipt remain to be checked before considering a separate trading grant. Keep `ALPACA_ORDER_SUBMISSION_MODE` unset. An order requires a separate decision by the account owner and funds they choose to risk.
