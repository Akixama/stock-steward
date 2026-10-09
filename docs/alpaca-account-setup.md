# Alpaca account and app setup for Stock Steward

An individual brokerage account and an Alpaca Connect application are separate approval paths. An account's status does not approve Stock Steward as a Connect app. The product can target eligible users in multiple countries; verify eligibility for each user and country through Alpaca's normal process. This repository contains no account credentials or personal brokerage records.

1. Confirm that the test account is eligible and funded before an approved live order test. Check [Alpaca's country availability guidance](https://alpaca.markets/support/countries-alpaca-is-available) or ask Alpaca support about country-specific funding or account questions. Do not bypass an eligibility decision.
2. The Stock Steward Connect app showed **Published** in Alpaca on 8 October 2026. Its website, callback, privacy, and terms URLs were updated to the Cloudflare deployment and persisted in Alpaca's editor. The app listing and consent page use broad transaction wording; publication alone does not verify a read-only grant or a working broker connection. See [the submission record](alpaca-connect-submission.md).
3. Keep the client ID, client secret, OAuth token encryption key, and any account or identity documents out of chat and Git. The Cloudflare Worker now has the client ID, client secret, paper environment, exact callback URL, and token encryption key as server-side secrets. The order-submission switch remains unset.
4. A paper account was connected with `data` scope on 8 October 2026 after the owner reviewed Alpaca's broad consent wording. The callback rejected any `trading` scope, verified the account reference, and a read-only refresh successfully read account funds, positions, open orders, and market clock. The market was closed. A fresh quote, daily fills, and a complete decision receipt still need a market-hours check. Do not treat fake-broker tests as account validation.
5. Only after the read-only path works, request the separate `trading` OAuth permission and test an exact owner-approved order under the deployment's explicit order switch. Begin with an amount you personally choose and can afford. Verify the client order ID, broker status, fill or rejection, and receipt against the Alpaca dashboard before allowing anyone else to use live trading.

Alpaca's [individual-account guidance](https://alpaca.markets/support/requirements-alpaca-brokerage-account) says non-US applicants may fund with as little as $1, and its [minimum-deposit FAQ](https://alpaca.markets/support/alpaca-minimum-deposit) says there is no general individual-account minimum deposit. Actual account approval, available funding methods, fees, and tradable assets depend on the account and country. Stock Steward's order planner currently rejects buy orders below $1, matching [Alpaca's stated minimum buy notional](https://alpaca.markets/support/can-we-submit-orders-smaller-than-1-usd-in-notional-value).

The account-opening and app-review steps happen with Alpaca, not inside Stock Steward. If a market is unavailable, obtain Alpaca's answer through support and choose a supported broker or an eligible tester; do not bypass the restriction.

## Prepared Connect application description

Use this as a starting point when Alpaca Connect app registration is available; update it to match the actual app and any questions in Alpaca's form before submitting:

> Stock Steward is an independent portfolio decision and order-control interface for eligible Alpaca brokerage users. A user connects their own account through Alpaca OAuth. The app reads current account, position, order, fill, asset, and quote data to check a proposed US-listed stock purchase against limits the user saved: approved symbols, maximum order amount, daily buy amount, and portfolio concentration. It records the observed figures, rule results, and reason in a decision receipt. Live orders are disabled by default. If enabled after testing, each order requires a separate trading permission and explicit account-owner approval of the exact symbol and dollar amount. The app submits one order attempt and looks up uncertain outcomes by client order ID; it does not retry an uncertain submission. Automatic trading and background monitoring are not active.

The published app points to the Cloudflare deployment. Disclose any commercial use accurately. Never paste the client secret, access tokens, identity documents, or full account details into an application description, chat, or repository.

## Connect form readiness

The Connect app is published. The app's website, redirect, Terms of Use, and Privacy Policy point to the public Cloudflare deployment. See `docs/alpaca-connect-submission.md` for the saved values and completed paper-account connection. Publication alone did not establish the connection; the callback and authenticated account read did.

The existing brand mark is available as [a 256px PNG](alpaca-connect-logo.png). The customer-facing screenshots are in `docs/alpaca-screenshots/`. The dedicated contact address is stocksteward.support@gmail.com. The Cloudflare site is public and uses a separate demo sign-in for practice workspaces.
