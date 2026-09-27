# Stock Steward

Stock Steward is a web-based exposure steward for Robinhood Chain wallets. It observes supported tokenized-stock holdings, applies user-defined purchase boundaries, and keeps inspectable evidence of what changed and what remains unknown. A separate Alpaca adapter supports traditional brokerage observations.

The project is **under development**. The hosted site reads Robinhood Chain mainnet holdings and saves indicative-price observations; it also has a working read-only Alpaca connection. User-signed execution and optional bounded autonomy are future stages. No live orders have been submitted and automatic spending is disabled. See `docs/autonomy-feasibility.md` for the researched Alchemy route and unverified setup costs.

## Separate Alpaca adapter: how it works

1. **Set boundaries.** The owner chooses approved symbols, a maximum per purchase, a daily buy limit, and a position concentration limit. Mandate changes are versioned.
2. **Observe.** Once an eligible account is connected, Stock Steward reads the account, positions, open orders, recent fills, asset eligibility, and a timestamped quote through the broker's authorized API.
3. **Check and explain.** A proposed buy is evaluated against every boundary. The receipt records the observed figures, pass or fail for each rule, the mandate version, the action, and the reason. Stale or incomplete evidence cannot produce an approval.
4. **Ask before acting.** The intended first live mode asks the account owner to approve the exact symbol and dollar amount. A separate trading permission and an explicit deployment switch are required before order submission becomes available.
5. **Follow the outcome.** Stock Steward records the submission attempt and later broker-confirmed status. An uncertain response stays uncertain until a lookup resolves it; the app does not silently retry an order.

The landing-page walkthrough is illustrative. Its numbers are not a live account, investment activity, or a broker response.

## Current scope

- The signed-in workspace owner can save a versioned mandate in local D1: approved symbols, maximum single buy, maximum daily buys, maximum position concentration, and an action preference. Approval is the default; automatic action is only a saved, inactive future preference. The evaluator still requires owner approval for every order. The local sign-in uses the Sites development identity; it is not a brokerage connection.
- `lib/decision.ts` evaluates a proposed buy against a fresh, authenticated broker snapshot and returns every passed or failed rule, a reason, and the condition that would change a hold.
- The order event model distinguishes account-owner authorization, one submission attempt, uncertain responses, broker acceptance, partial fills, and terminal outcomes. A held decision cannot become an order, and a fill cannot be recorded before broker submission.
- A checks-passed receipt has an exact-order review panel. The owner can decline the proposal once. Approval and submission are available only when an eligible account has granted separate trading scope and the deployment's order switch explicitly matches its Alpaca environment.
- A connected owner can recheck an earlier proposal from the trail. It creates a new receipt from fresh Alpaca data and preserves the earlier receipt for comparison.
- A fresh checks-passed receipt can return an Alpaca order plan with the exact stock, dollar notional, account, day market-order shape, and deterministic client order ID. It expires no later than 30 seconds after the underlying quote. The server rejects changed mandates, accounts, failed checks, declined receipts, stale evidence, and unsupported sub-dollar orders. The owner must acknowledge the exact order before the guarded submission route can send it.
- `lib/broker-boundary.ts` loads an owner-bound mandate and requires an injected server-side broker reader. It rejects account or symbol mismatches and persists a receipt only after a valid evaluation.
- Alpaca Connect OAuth routes are implemented. The initial connection requests read and market-data access. A separate trading-consent route is available only when the deployment switch is enabled; its callback requires the same broker account. Tokens are encrypted in D1 and their trading-scope flag is stored separately. `lib/alpaca-reader.ts` obtains the required figures from authenticated account, position, asset, order, quote, and fill responses. Each receipt preserves the quote timestamp separately from the finished account-read time; quotes older than 30 seconds cannot produce a decision. No OAuth app credentials or account are configured in this checkout.
- `db/ledger.ts` and `drizzle/0000_gigantic_frank_castle.sql` define a D1 repository for versioned owner-bound mandates, decision receipts, and append-only order events. The workspace saves and reads from this local ledger. An older device-only mandate is offered as a draft for review and is removed from browser storage only after a successful server save.
- The UI starts with an empty decision trail and a disconnected broker state. It contains no sample investment activity.
- `/` is a public landing page with a 10-second illustrative decision walkthrough. The figures in that walkthrough are an example, not account activity or a live broker response.
- `/workspace` is the signed-in mandate and decision-trail workspace. Its top navigation opens Overview, Mandate, and Decision Trail; the mandate shows a live draft summary and can reset unsaved edits. It displays receipts only if the owner-bound server ledger contains them.
- `/connect` is a signed-in permission review before Alpaca OAuth. Initial consent requests account data only. A separate trading review displays Alpaca's required transaction-access disclosure; continuing requires a same-origin POST. Hosted read-only consent is configured; order submission remains disabled.
- `/account` shows the signed-in user's site identity and broker permission status. Sites handles the sign-in and sign-out flow; the broker connection remains a separate Alpaca OAuth grant.
- `/privacy` and `/terms` explain current data and order behavior. `/account` lets a signed-in owner record a deletion request; handling and erasure are manual and described in `docs/data-requests.md`. Public operator wording needs a jurisdiction-specific review before a broad customer launch.
- `/guide` is the technical product guide, with chapters on the current implementation, mandate, evidence contract, decision checks, receipt model, and the work needed before real-money use.

When the mandate form, `lib/decision.ts`, broker adapter, receipt persistence, or execution behavior changes, update `lib/product-guide.ts` and the corresponding `/guide` chapter in the same change. Keep the capability table and disconnected-state wording aligned with actual behavior.

## What remains before real-money use

The hosted site has configured read-only Alpaca OAuth and has observed a real connected account; fresh market-hours complete checks and funded order execution remain unverified. There is **no enabled order submission or background monitor**. Source-only deployments require their own credentials. The `source` field alone is not proof of authentication; the server-side OAuth token and account match establish provenance. The decision endpoint accepts only a symbol and dollar amount from the browser, never account figures.

Stock Steward targets eligible brokerage users in multiple countries, initially for US-listed stocks with USD purchase limits. Robinhood Chain is the primary product direction; Alpaca Connect remains a separate working reference integration. Credentials are configured as hosted secrets, not committed source; read-only real-account observations have succeeded. Separate Alpaca Connect app approval is needed for live trading by other users. The broker boundary remains provider-independent so another supported broker can replace Alpaca if necessary. See `docs/broker-selection.md` and `docs/alpaca-account-setup.md`. The current reader fails closed on stale quotes, incomplete history, and open buy orders whose value cannot be determined safely. The approval, submission, and manual broker-order lookup code uses fake responses in tests but has not been verified with an eligible funded account. Automatic action remains inactive.

The order plan alone is read only and is not persisted as an order. The guarded approval route revalidates the current mandate and receipt, records exact owner authorization, claims an account-level order gate, reruns every limit against a fresh authenticated broker snapshot, and records that recheck with the unique submission attempt before sending at most one POST. Only one Stock Steward order can be pending for an account. After a broker-confirmed terminal outcome, another order needs a decision observed after that outcome. A timeout, malformed broker response, or HTTP error is treated as unknown; the app never retries POST automatically. The manual reconciliation route looks up the deterministic client order ID and records broker-confirmed status. Background monitoring, correction/bust handling, and a real-account end-to-end test remain before any launch claim.

The decision trail also has a manual refresh for pending orders among its 50 visible receipts. It performs broker GET requests only, reports unresolved lookups, and closes approvals older than one minute that never reached a recorded submission attempt. It does not run while the owner is away from the page; it is not a background monitor.

## Configure Alpaca Connect

Register an OAuth app with Alpaca, then set `ALPACA_CLIENT_ID`, `ALPACA_CLIENT_SECRET`, `ALPACA_REDIRECT_URI`, `ALPACA_TOKEN_ENCRYPTION_KEY`, and `ALPACA_ENV` (`paper` or `live`) as server-side secrets. The redirect URI must be this site's `/api/broker/alpaca/callback`. Generate the encryption key as 32 random bytes encoded in base64; keep it stable, private, and backed up because changing it makes stored connections unreadable. Never put these values in browser code or commit them. The initial OAuth request asks only for data and read access. `ALPACA_ORDER_SUBMISSION_MODE` is unset by default; set it to the exact `ALPACA_ENV` value only after the account, app approval, and complete flow have been verified. This reveals a separate trading-scope consent link. Apply all four D1 migrations before connecting. Disconnect deletes the local token; broker-side revocation remains a separate account-owner action.

## Run locally

Use Node.js 22.13 or later. Install with `npm ci`, then run `npm run build` once to generate `dist/server/wrangler.json`. For a fresh checkout, apply all five SQL files in order to local D1:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_gigantic_frank_castle.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_orange_queen_noir.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_panoramic_victor_mancha.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_bumpy_mephisto.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_round_fallen_one.sql
```

Then run `npm run dev`. The local URL is printed by the server. The local preview provides a development sign-in identity. Run all six relevant suites with `node --test lib/decision.test.ts lib/broker-boundary.test.ts lib/alpaca-reader.test.ts lib/approval-plan.test.ts lib/alpaca-order.test.ts lib/order-flow.test.ts` on Node.js 24 or later. Order tests use fake broker responses and never contact Alpaca. The migrations are generated from `db/schema.ts` and have Drizzle snapshots. On this Windows host, generation needed a temporary `os.userInfo()` preload for Drizzle's CLI dependency.

The Sites deployment configuration in `.openai/hosting.json` identifies this project's preview. It contains no broker credentials.

### Anytime observations
Connected users can manually read broker balances, positions, open orders and market status outside regular hours. Valuations may reflect the last session; retrieval time does not certify fresh prices.

Closed-session proposals save owner-bound partial observations separately from decisions. Symbol, single-purchase and available-funds checks are recorded; full daily exposure, concentration, trading eligibility and quotes remain pending. Partial records cannot authorize orders. The trail shows the broker-reported next opening; rechecks are manual. Hosted order submission remains disabled and no live trades have been verified.

## Robinhood Chain web steward
Overview supports browser EVM-wallet connection or watch-only address entry. Reads verify mainnet 4663, use official asset contracts, and pin balances to one block. No signing or gas is needed. ETH is separate from stock tokens.

Coverage excludes other crypto and DeFi positions. Failed reads never imply zero balance. Indicative stock-token valuation uses matched official quotes and shares-per-token multipliers. Observe & save stores private records under the signed-in site user; history is limited to the latest 20 per query. Comparisons distinguish quantity, multiplier and price changes without inferring profit or transaction causes. Purchase previews apply saved symbol and size limits while daily accounting, full-wallet concentration, funds and execution eligibility remain pending. Mobile wallet linking, verified ownership, background monitoring and trading remain unavailable. Alpaca remains a separate integration.

### Autonomous engine foundation

Stock Steward aims to act automatically within user-defined authority, with inspectable receipts. The current workspace includes manually requested autonomy readiness checks and stored blocked receipts. The mainnet infrastructure reader checks chain identity and documented Uniswap/Alchemy contracts at one block. Atomic spending reservations retain uncertain outcomes across day boundaries; fee guards require complete fresh setup estimates and a capped budget. These accounting/fee modules are tested foundations, not a running executor. Read-only scheduling and external transaction watches are implemented, with runner activation separately gated. No session signer, swap route, live permission or automatic spending is enabled.

Run core checks: `node --experimental-strip-types --test lib/autonomy.test.ts db/autonomy.test.ts`. See `docs/autonomy-feasibility.md` for concrete prerequisites and verified versus pending evidence.

### Read-only monitoring runner

The authenticated GitHub workflow wakes every 15 minutes and handles at most two due wallet schedules and three transaction watches. Database leases, stable retry IDs and revision fencing prevent overlap and discard paused results. Three consecutive observation failures pause a schedule. GitHub wake-ups may be delayed or disabled after repository inactivity; actual run timestamps are visible.

Setup requires a dedicated server secret and encrypted GitHub Actions secret named STEWARD_WORKER_KEY. Never commit it. Set server STEWARD_RUNNER_ENABLED=true only after runner verification; start/resume stays disabled until then. The key permits read-only wakes, not signing or spending. Workflow logs contain summary counts only.

External transaction watches label RPC finality separately. Outer success does not prove a swap or user-operation outcome. Unknown/reorged evidence never releases reservations or triggers resubmission.

### Route inspection and wallet control

Autonomy can inspect four direct USDG/official-stock Uniswap v4 pool keys at one block. It verifies network identity, deployed contracts, the quoter/state-view pool-manager reference and the canonical block hash before saving evidence. Quoter output is raw stock-token units, not shares; USDG input is a token amount, not a guaranteed USD price. Missing quotes are scoped to this search and do not prove all venues are unavailable. Quote expiry is bounded by both block and observation time. A quoter gas estimate excludes full router/account execution and setup.

Optional wallet verification uses a domain-bound five-minute personal-sign message. EOA recovery and deployed ERC1271 verification are supported. Nonces are owner-scoped, single-use and replaced atomically. Counterfactual undeployed wallets are not supported. Proof is historical and grants no token approval, delegation or spending authority. No private key or stored signature is involved.

The execution preflight core checks pause, account, mandate version, route freshness, onchain permission coverage, eligibility, accounting, full account simulation, complete fees and exact approval. It is an internal tested foundation; no signer or submission adapter is wired, even if its checks pass. Alchemy's documented contract/function permission alone does not establish recipient and output-token restrictions inside router commands. No broad/root permission is requested.

### Browser-wallet onboarding

Choose a detected EVM wallet explicitly (EIP-6963, with a browser-default fallback), connect its public account, and request a separate short-lived ownership message. The selected provider is used consistently for verification; exposed account and network are rechecked before and after signing. A deliberate Robinhood Chain switch/add button is available. No private key input, account-access request during discovery, token approval, transaction or session grant is made. Watch-only inspection remains available. Mobile WalletConnect and built-in wallet creation are not implemented.

Wallet labels are extension-supplied, not verified identities. Network configuration follows [Robinhood documentation](https://docs.robinhood.com/chain/connecting/); multi-wallet discovery follows [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963).

### Test the current release

Open `/guide#testing` for the combined owner walkthrough. It needs no trading funds: saved mandate, public holdings, explicit wallet choice, network switch, optional ownership signature, route evidence, receipt export, and opt-in read-only monitoring. Execution remains disabled. Internal preflight binds simulation and exact approval to the complete trade intent and rejects changed or malformed amounts.
