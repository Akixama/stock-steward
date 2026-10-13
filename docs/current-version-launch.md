# Historical approval-only launch checklist

Historical scope: Practice plus owner-approved Robinhood Chain purchases. Superseded by the single-release scope in full-release-scope-2026-10-12.md; autonomous execution gates remain outstanding.

## Engineering checks completed

- Existing $10 purchase verified and saved as finalized; actual USDG and AAPL quantities displayed.
- Two expired legacy budget holds released using complete finalized owner-nonce evidence.
- Native AI drafting configured and a complete live synthetic direction checked; malformed/incomplete output fails closed.
- 279 application/database tests, 19 deployed route/auth checks, TypeScript and production build passed during the preceding audit.
- Separate source/isolated-contract and deployed/chain-evidence audit passes recorded in `verification-2026-10-10.md`.
- Landing page, guide and factual terms/privacy descriptions updated to describe this approval-based pilot.
- Launch-copy deployment `662ea211-602a-4c9d-b636-0f9b45d11671`: build and TypeScript passed; 19 deployed route/auth checks passed again.

## Owner wallet checks still required

Use https://stocksteward.app/workspace and the same wallet used for the existing purchase, on Robinhood Chain 4663. These tests do not require another purchase or deposit. Signing revocation and activation does require network fees.

1. Connect the wallet, complete ownership verification if requested, and refresh the permission review. Confirm the address, approved tokens, limits and expiry match your saved Mandate.
2. Open **Permission controls → Turn off permission**, then **reject** the request in your wallet. The interface should stop, report rejection and never claim that permission is revoked. Refresh the review: permission should still be active. A rejected request must not restart automatically.
3. Repeat **Turn off permission** and approve it yourself. Wait for confirmation, then refresh the review. Permission must be inactive; do not rely solely on a submitted transaction hash.
4. Choose **Activate permission** and review the policy and fees. Approve the combined setup transaction in your wallet when offered. Wait for confirmation and verify every required readback check passes.
5. Reload. Confirm the permission state persists, the existing purchase remains finalized and there is no duplicate order or additional payment.

Record actual outcomes before marking these steps passed. If a step fails or remains uncertain, retain the transaction hash and investigate it before retrying.

## Known limits and release decision

- Development-tool dependency advisories remain; the checked registry had no compatible patched `braces` release. Production-only dependency scanning found zero known advisories. Keep development servers private and track the required toolchain migration.
- AI testing is evidence for the checked prompts, not a general accuracy guarantee. Users must review every draft.
- Future hashless reservations require evidence-based reconciliation; age alone is insufficient.
- This is an early-access pilot with internal engineering verification, not an independent smart-contract security audit or unrestricted trading release.
- Wallet tests are pending. Public launch sign-off is not recorded yet.

## October 11 wallet-test finding

The owner rejected a revocation request; the UI correctly reported that revocation did not complete. MetaMask also warned that the request would likely fail. Investigation found that the client was calling the Roles module directly, although its administrative owner is the Safe. Corrected revocation wraps the same role-removal call in an owner-signed Safe `execTransaction`, with zero value and ordinary CALL operation. Read-only mainnet simulation returned success; all 10 installation tests and TypeScript passed. No revocation was submitted by the agent. Actual owner-approved revocation/reactivation remains pending.

## Oct 11 — revoked role verification and clearer workspace

Deployed version: 173671a0-46eb-4d66-bac1-8a636a76ca2c.

Read-only chain audit located successful revocation 0xf3b400a81b6fc3236039b30974245c63607df4da411182ba3a6cec3362f0758d. AssignRoles removed the exact bounded role; owner nonce history through the audit head contained no later restoration.

Corrected live readback: module enablement does not establish role membership. The pinned runtime is probed using eth_call from the session to a forbidden zero target. Exact NoMembership means revoked; exact target-denied ConditionViolation after membership verification means active; all unknown responses fail closed. This check now covers module discovery, permission recording, order preparation and historical reconciliation. Confirmed revocations also require the exact role-removal event before the UI claims permission is off.

The panel refreshes status without signing, shows Permission off/active/not verified, hides raw contract checks under Technical checks, and clears obsolete activation updates. Limits, fee coverage and funding instructions use shorter wording. No funds transferred, no new grants, no transactions submitted during this change.

Verification: 281 application tests, 39 isolated EVM scenarios, typecheck and production build passed; 19 live route/auth checks passed. Mainnet archive check proved membership active at the earlier checkpoint and revoked now, with new orders blocked by corrected readback. Authenticated visual inspection was unavailable because the browser tool had no open signed-in tab; the deployed workspace bundle was independently checked.

## Oct 11 — visual redesign of permission and funding

Replaced sentence-heavy permission review with a three-value limits panel and separate fee estimate. Permission state appears above actions, with an explicit icon and text badge for off/active/unverified. Verification checks use compact rows under an accessible native disclosure. Funding cards use matching spacing, typography and controls. Narrow screens stack panels and turn limits into readable rows.

Visual verification used the actual shared permission components with clearly marked sample data: desktop, 375px and 320px previews, plus expanded verification details. No horizontal page overflow at 320px. Typecheck and production build passed. Trading and signature handlers retain their existing behavior.

## Oct 11 — permission record dates after reactivation

A read-only mainnet check proved the module active with all seven required readback checks passing under its installed UTC window. Rebuilding the same policy with today's UTC window made both quota checks fail. The record POST previously preserved the installed window only when no output prices were posted; a completed activation posts prices, so that path silently discarded the saved dates.

Recording now selects the saved window for the exact matching module independently of whether install-time prices are posted. Malformed prices are rejected before rebuilding the policy; different modules cannot inherit the saved window. Save failures identify failed checks and no longer promise that no further signature is needed without evidence. No wallet transactions were submitted for this repair.
