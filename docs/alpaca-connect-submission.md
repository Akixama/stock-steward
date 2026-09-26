# Alpaca Connect submission package

This is a preparation record, not proof of app approval or a live broker connection. Check every URL and screenshot against the public deployment immediately before submission.

## Status — 26 September 2026

The early-access preview and its policy pages are public. The signed-in deletion-request flow is deployed and its D1 table exists. The Alpaca form has its name, category, description, website, callback, policy URLs, and project logo prepared. Screenshots have not been uploaded, the Terms agreement is unchecked, and the application has **not** been submitted. No Connect credentials or live account connection are configured. Screenshot file export was blocked by the browser's URL security policy; finish the captures through a supported user download/upload flow.

| Form item | Stock Steward value |
| --- | --- |
| App name | Stock Steward |
| Public website | `https://stock-steward-brokerage.allianjola.chatgpt.site/` |
| OAuth redirect | `https://stock-steward-brokerage.allianjola.chatgpt.site/api/broker/alpaca/callback` |
| Privacy | `https://stock-steward-brokerage.allianjola.chatgpt.site/privacy` |
| Terms | `https://stock-steward-brokerage.allianjola.chatgpt.site/terms` |
| Contact | `stocksteward.support@gmail.com` |
| Logo | `docs/alpaca-connect-logo.png` |

## Application description

> Stock Steward is an independent stock-purchase review and order-control project for eligible brokerage account owners. Users save limits on symbols, single buys, daily buys, and position concentration. With their separate Alpaca OAuth consent, the app reads their account, positions, asset status, open orders, fills, and market quotes to check a proposed purchase. It saves a decision receipt showing the observed evidence, each rule result, and why the proposal was held or allowed. The initial connection asks for read access only. Live ordering is disabled in the current deployment. After Alpaca approval and real-account testing, any enabled order would require separate trading permission and the account owner's approval of the exact symbol and amount. Automatic trading and background monitoring are not active.

Disclose any planned commercial use accurately in Alpaca's form. Do not claim Alpaca endorsement or live trading capability. Use the actual operator information that applies to the project in any private application field; the public brand is Stock Steward.

## Customer-facing screenshots

Capture the **deployed** pages after publication, at the form's requested size (previously 1024 × 500 pixels):

1. Landing page with the illustrative walkthrough and disconnected-state note.
2. Workspace Overview and Mandate, showing empty broker status and saved-limit controls.
3. Decision Trail, showing an empty state until authenticated broker evidence exists.
4. `/connect` read-only consent explanation and `/connect?intent=trading` transaction-access disclosure. Capture both even though the buttons are disabled in this deployment.
5. `/account`, `/privacy`, and `/terms`, including the data-request path and support contact.

Keep account emails, support IDs, balances, tokens, and other personal data out of screenshots. The form may change; verify its current required pages and dimensions before uploading. Its submission, credentials, review outcome, and any trading approval must be recorded separately.

## After submission

Store the client ID, client secret, redirect URI, and token encryption key only as hosting secrets. Begin with read-only OAuth on an eligible account. Verify the real account reference, quote timestamp, positions, orders, fills, and decision receipt before enabling a separate trading grant. Keep `ALPACA_ORDER_SUBMISSION_MODE` unset until the exact-order flow has passed a controlled real-account test. An order requires the account owner's explicit approval and funds they choose to risk.
