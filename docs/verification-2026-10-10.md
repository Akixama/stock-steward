# Stock Steward verification — October 10, 2026

## Scope and result

All six requested areas were reviewed. Fixes were published to https://stocksteward.app/workspace.
Latest deployment: `99c044f0-6edf-4fb6-90d7-79ae5133eca0`.
This is an internal engineering review, not an independent smart-contract security audit or a guarantee that no bugs remain.
No wallet signatures, new purchases, fund transfers or permission revocations were performed during this review.

## Two different audit passes

1. **Source, database and isolated execution:** inspect the permission, receipt and spend flows; run unit/regression tests, TypeScript, lint, the production build, dependency checks and the local contract laboratory.
2. **Deployed behavior and independent evidence:** read the existing transaction and historical policy state from chain providers, compare transfers with wallet balances and the deployed ledger, run black-box authentication/API checks, and inspect the authenticated workspace in a browser. Navigate all seven workspace views and check mobile layout without saving changes or authorizing actions.

### Verification results

| Check | Result | Limits |
| --- | --- | --- |
| Application/database tests | 279 passed, zero failed after follow-up | Automated scenarios, not every possible input |
| Scheduler tests | 3 passed | No new scheduler-triggered financial action |
| Isolated contract laboratory | 37 scenarios passed | Canonical Safe/permission bytecode with fixture assets and a router test double; not a real new mainnet swap |
| TypeScript | Passed | Static type checks |
| Production build | Passed | Cloudflare deployment also succeeded |
| Lint | Zero errors; 26 warnings | Existing unused/dependency warnings remain; these are not a clean-lint claim |
| Deployed public/API authentication tests | 19 passed | Covers public pages, protected endpoints, forged identity headers and invalid sessions; not a comprehensive penetration test |
| Client asset secret check | 28 assets, two configured secrets, zero matches | Exact values checked; not a proof about every possible secret |
| Browser checks | All seven workspace views opened; mobile plan/strategy had no document overflow; no captured console errors | Connected-wallet signing is left to the owner |
| Production dependency scan | Zero known advisories | npm's production classification excludes build-tool dependencies |

## The six areas

### 1. Purchase, balances and accounting

Existing transaction:
`0x79219686bbe2c60ec82c3f6c43e6264f7b168d440202e864e7370c16df8903b5`

- Canonical finalized block and exact transaction evidence verified.
- Exactly **10 USDG paid**, with **0.029651081888335979 AAPL tokens received**.
- The Steward Safe holds **1 USDG** and the received stock tokens.
- The deployed order ledger records that purchase as **confirmed**.
- Two older $10 reservations were released after proving their exact signed envelopes never succeeded. Archive nonce counts, a bounded binary search of canonical blocks, and finalized receipts accounted for every owner nonce from 12 through 18. Both route deadlines preceded the finalized checkpoint. The deployed ledger now contains two released reservations and one confirmed $10 purchase. No funds moved during this accounting correction.

The public node had pruned historical contract state. Receipt verification now combines public canonical transaction/receipt/header reads with the configured private provider for historical state. No latest-state substitution is accepted as historical proof.

### 2. Reliability and recovery

- Record a submitted wallet hash atomically and idempotently, including retries after a save timeout.
- Retain only a bounded hash/intent recovery pointer in session storage while the server record is unsaved; clear it once recorded.
- Clear the prepared order as soon as the wallet returns a transaction hash so a save failure does not offer the same purchase again.
- Add bounded status/receipt/reconciliation waits and scheduled retry handling.
- Restore existing receipts after refresh and keep finalized receipts durable during later provider outages.
- Check the wallet account and chain before signing.
- Parallelize policy readback and preserve the original installed permission dates across UTC midnight.
- Apply additive migration `0019_active_module_window.sql`; existing records retain their original window using the recorded verification date.

### 3. Safeguards

Regression and contract scenarios cover owner separation, bounded amounts, daily/total quotas, expiry, insufficient funds, exact transaction identity, malformed/foreign proofs, unavailable RPC, canonicality changes, duplicate submission and reverted transactions.
Quota readback checks refill, period, remaining balance and timestamp, not merely its maximum. Unknown evidence retains a hold and cannot become a verified fill.

### 4. UI clarity

| Before | After |
| --- | --- |
| A successful purchase could remain a vague pending message | Separate transaction confirmation, finality and a durable **Purchase finalized** receipt |
| Funding prompts could accompany an already submitted purchase | Submitted-order panel says no additional funds are needed for that order |
| The budget total resembled money already spent | Label says **Committed**, includes pending orders, and explains that reservations are not payments |
| Only a funding balance was obvious | Show actual USDG and stock-token quantities; failed reads remain unknown rather than zero |
| Hardcoded $1 order and inactive-status copy | Use saved limits and explain that the owner approves every real order |
| Serial readback and render/effect lifecycle errors | Parallel reads, cancellable mount/reset work, stale ownership-response protection and reduced-motion handling |

### 5. Security and dependencies

Owner-scoped order/permission routes and mutation-origin checks were reviewed. Public black-box tests reject missing authentication, spoofed identity headers and invalid signed sessions. The server computes and verifies; it does not sign wallet transactions.

Patched Next, React/RSC, Vite, Vinext, Cloudflare build/deployment tools and compatible transitive dependencies; updated the lockfile without forcing incompatible peers. ZIP/WebSocket/image-parser overrides are pinned to patched versions.

**Remaining dependency findings:** the full toolchain scan reports 12 affected package entries (8 high, 4 moderate). These mainly propagate from the unpatched `braces` pattern parser in glob/lint/build tools and old `esbuild` under Drizzle's loader. The registry currently offers no patched compatible `braces` release; npm suggests destructive framework downgrades for several propagated entries. Those suggestions were not applied. The old esbuild advisory concerns its development server. This is a known maintenance/security limitation, even though the production-only scan is zero.

Do not expose development servers publicly. A separate dependency migration and independent contract review remain appropriate before expanding the live pilot.

### 6. Publish and verify

The final production build was deployed to the existing custom domains. Afterwards, the public/API checks passed and the authenticated workspace displayed the finalized saved receipt after reloading, with the correct balances and no captured browser console errors.

## Remaining owner checks and product limits

- Reconnect the same wallet on Robinhood Chain and verify the existing permission readback.
- Personally test wallet cancellation/rejection, and revocation/reactivation if desired. Those actions can require network fees and must be approved by the owner.
- A future purchase is a separate financial action. This review does not ask for another purchase or deposit to prove the already finalized order.
- AI drafting is now configured through the native Workers AI binding. Replaced a retired model and incompatible provider grammar mode. A live complete direction returned the expected $1 AAPL / 24-hour / $20 cash reserve / approval draft; an incomplete direction failed closed. No test draft was saved or activated. Broader model accuracy is not established by these two cases.
- Legacy reservations were resolved with complete finalized owner-transaction evidence. Future reservations without recorded hashes still require evidence-based reconciliation; automatic age-only release remains unsafe.
- Real orders remain an approval-based pilot. This review does not establish readiness for unrestricted autonomous real-money trading.

Diagnostic files under `outputs/` contain local audit evidence and should not be published indiscriminately. No claim of 100% completeness or universal bug freedom is made.

## Follow-up verification

- Latest build and deployment succeeded; TypeScript passed.
- All 279 application/database tests passed, including native AI binding validation and sanitized provider error diagnostics.
- All 19 live route/auth checks passed again after the final deployment.
- No new wallet signature, purchase, transfer, permission grant or revocation was performed.
- Wallet rejection/cancellation and live revocation/reactivation remain owner-operated checks. Development-tool dependency advisories remain as described above; no compatible patched `braces` release was available in the checked registry.
