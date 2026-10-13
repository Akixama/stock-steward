# Autonomous trading implementation — October 13, 2026

## Release boundary

Production unattended spending remains compiled off in `lib/autonomous-live.ts`. No environment variable or workspace action can override it. The existing owner-signed pilot is unchanged. The deployed background runner is SHADOW ONLY: it evaluates all 12 strategy types and stores explanatory receipts. A triggered rule is not an authorized trade.

Current deployed worker: `b9d42ff4-3725-4339-ba8b-05861f87f465`. The production configuration enables AI drafting and read-only shadow evaluation only.

## Implemented this pass

| Area | Implemented | Remaining release evidence |
| --- | --- | --- |
| Session execution | Offline signing of the exact zero-value Roles/Safe/router envelope, recovered signer verification, chain/nonce/fee checks, grant/mandate binding | Owner-approved separate session grant; production evidence adapter and verified key configuration |
| Decisions | Bounded planning for all 12 buy, sell and portfolio-management strategy types; fresh evidence and mandate checks; opt-in shadow scheduling | Production provider credentials and operator evidence for every source, including authenticated news |
| Reliability | Durable signed hash before broadcast; one account lock and one session nonce per intent; no automatic retry after uncertain broadcast; budget holds retained | Production adapter rehearsal and operator incident alerts |
| Controls | Pause/resume/save revision fences; leases; stale results discarded; three-error circuit breaker; current-grant rechecks before signing/broadcast | Owner-controlled session activation and actual revocation rehearsal on deployed account |
| Monitoring | Saved shadow receipts, per-check reasons, history and download; no keys or raw signed transactions exposed over HTTP | Operator alerts for future real autonomous submissions and final settlement |
| Security/testing | Owner/address-authenticated AES-GCM signer ciphertext; isolated database/crypto/executor tests; application suite and actual-runtime permission lab | Independent contract/security review and owner-approved funded autonomous trial |

## Operator and user paths

The workspace's Advanced section now contains Autonomy preview. Load status, save a paused buy rule, then start shadow checks. Checks use the existing background tick, may run after the scheduled due time, and never request wallet access. Pause prevents a pending quote from becoming a recorded decision. Existing Practice and owner-signed orders remain separate.

`/api/workspace/autonomy/shadow` is authenticated, origin-checks mutations, limits request size and scopes plans/history to the signed-in account. Browser-supplied fields cannot enable signing. Session transaction material is internal only.

Additive migrations: `0020_autonomous_shadow.sql`, `0021_autonomous_transaction_journal.sql`, `0022_autonomous_session_grants.sql`, and `0023_autonomous_journal_settlement.sql`. They create tables and add a settlement column. Existing records and balances are not rewritten. Generated deployment configuration explicitly enables the read-only shadow worker, not autonomous execution.

## Remaining work before unattended funds

1. Obtain independent smart-contract, signer, execution and operational security review against the frozen source digest and permission package.
2. Configure and verify production evidence providers, including authenticated market news, account eligibility, complete portfolio/history coverage and fee sources.
3. Run the owner-approved funded lifecycle rehearsal: install the separate session grant, execute a tiny bounded order, pause, recover an uncertain receipt, expire, cancel and revoke.
4. Configure the operator alert destination and prove incident delivery, acknowledgement and recovery in the production environment.
5. Record the review, eligibility and rehearsal evidence, then make a separate owner-approved release that changes the compiled spending gate. The current deployment cannot turn itself on.

## Current verification

- 364 application and archived-adapter tests passed.
- TypeScript, ESLint with zero errors, production build and full repository/history secret scan passed.
- The isolated permission lab passed 44 scenarios against pinned runtimes and fixture assets. It used no live wallet and spent no real money.
- All 19 deployed page, redirect and authentication checks passed after release.

## Signing references

The offline signer uses viem's documented sign-then-send separation: https://viem.sh/docs/actions/wallet/signTransaction . The session envelope uses Zodiac Roles' documented role-member execution: https://docs.zodiac.eco/developers/roles/execution . Documentation is not independent verification of this implementation.


## Verification and deployment

October 11: 301 application tests passed, TypeScript check passed, production build succeeded. The separate isolated contract-runtime lab passed 46 scenarios; fixture assets were used and no live grant or funded autonomous trade was performed. Published worker version: c3093ebc-a5be-4a92-a272-65bf8e4a55c1. Actual unattended execution remains compiled off. These checks do not guarantee absence of bugs or replace independent security review.

## Second implementation pass

Added account-scoped, deduplicated incident inbox with read acknowledgements; uncertain submissions retain their journal and reservation. Terminal outcomes and repeated preview failures generate saved updates. Added unsigned session review UI, authenticated exact-grant verification, server-side pause, and rate-limited read-only execution preflight. Verification requires exact owner transaction data plus current onchain permission and wallet ownership. No activation or signer broadcast is exposed by these routes.

Fixed settlement quote freshness: CoinGecko's source timestamp is preserved instead of replacing it with fetch time. Cached quotes now fail the fresh accounting gate.

305 application tests passed, including cross-account incident acknowledgement, duplicate incidents, changed mandate and mismatched confirmed transaction rejection, and stale settlement pricing. TypeScript check and production build passed. Migrations 0024/0025 add incident records and grant verification metadata.

Production execution-grade accounting, complete network-fee evidence, account eligibility and independent review remain unresolved release gates. The new preflight names them explicitly; it is not a completed live execution adapter. Wallet activation remains unavailable pending those gates. See autonomous-security-review.md for the review scope and owner rehearsal checklist. No external reviewer was commissioned and no new wallet transaction was submitted.

Additional accounting correction: the concentration denominator values other holdings at their lower verified bound, while valuing the target at its upper bound. A regression test proves a wide quote on another asset cannot dilute the target's concentration. This is conservative readiness accounting; it does not resolve the execution-grade source coverage and fee gates.

A read-only live wallet probe observed funding and the previous purchase. The proposed probe order failed the dollar amount and concentration checks. The probe used an empty probe ledger and is not proof of zero prior spend. No new transaction was sent.
Final application suite: 306 tests passed. TypeScript check passed. New live endpoint checks: five authentication checks passed, in addition to the 19 existing production page/auth checks.
Final published worker version: b11bda03-695c-4863-b2f1-fef814ee0e64. The compiled automatic-spending gate remains false.

## Third implementation pass — block-bound sources and fee inspection

Added `execution-sources.ts` and connected it to read-only autonomous preflight. The adapter scans official registry assets plus paginated discovered assets, establishes quantities and decimals through RPC at the route block, rejects unknown nonzero holdings and reorgs, checks closed history pages and independently scans current UTC-day token transfer logs. Daily events must agree with canonical receipts. Stock USD bounds apply the official corporate-action multiplier exactly once; ETH uses timestamped ETH/USD bid/ask and USDG preserves its actual price timestamp. Stale quotes fail closed.

Added `execution-fees.ts`: exact Roles envelope simulation, corroborating gas estimates, Arbitrum posting component, pending nonce and session gas balance. The posting component is already in total gas and is not charged twice. Fee ceilings use a 20% gas margin, twice the estimated base fee plus priority, and upward USD rounding. An estimate is not owner approval: the preflight explicitly requires a stored owner-reviewed maximum fee.

Verification: the full 317-test suite passed, followed by 13 focused adapter/fee tests including two additional history tests. TypeScript and production build passed. Published version: `12758f51-12e4-4fef-a108-a2b12df3549c`. No wallet signature, key loading, broadcast or transfer occurred. Automatic spending remains compiled off.

Remaining: stored owner-reviewed fee limits; production executor preparation and eligibility evidence; live funded separate-session rehearsal; independent security review. Source review must address unsupported assets/internal native movements, historical spend classification, quote freshness across lengthy history scans, and synchronous RPC limits. These read-only improvements do not prove that the complete autonomous release is ready.

## Fourth implementation pass — October 12, 2026

Deployed worker ba6b7b90-af12-45aa-928b-52e13807b71f. Review source digest: 0xb8658f9b713989247464227a7f38345282ce7cff2ff6365b1860b4be48e69f76.

Implemented signed owner fee ceilings, exact-code/account/policy external review proofs, explicit automatic-start consent, production preparation adapters, encrypted session storage, conservative USDG sizing, and owner session installation/verification controls. Added a separate owner-approved single real session purchase path with exact short-lived intent signing, durable claim/journal, no submission retry, and preserved hashes on uncertain responses. Pause blocks subsequent session signing/submission. A separate owner-wallet revocation control pauses server purchases before presenting the precise role-removal transaction. Migrations 0026–0028 were applied remotely.

Verification: 336 application tests passed; 22 focused executor/approval/revocation tests passed after the final bundler fix. TypeScript and production build passed. The independent testing method was the isolated pinned contract-runtime lab: 46 scenarios passed with fixture assets, not live funds. Production smoke checks passed: 19 existing page/auth checks and seven new session authentication/no-store checks. These checks do not establish absence of all bugs or an independent security audit.

No wallet transaction or funded session rehearsal was performed. Genuine review authority addresses and eligibility/security/rehearsal signoffs are not configured. Automatic execution remains compiled off. The new manual purchase path requires exact owner approval and eligibility/security reviews before key access. This is a bounded initial two-day pilot; continuous renewal and recovery lifecycle work remains before calling unattended trading complete. Follow autonomous-owner-checklist.md; the remaining work is not only wallet signatures.

## Fifth implementation pass — October 12, 2026

Published worker: f784afeb-70d0-4ecb-a281-d7d92ef1c824. Source digest: 0xbf156fc094f958f31e650c0320b0986bd88473f048c9bfab03f861b48895b276.

Implemented session retirement, archived grants, fresh-key renewal for the same Safe and unchanged mandate, and crash recovery for manual session requests. Migration 0029 applied remotely. Retirement verifies the chain, pinned Safe proxy/implementation, sole owner, removed exact role membership and canonical block. Atomic archival is denied while any account purchase or lock is unresolved. Encrypted signer records, purchase history and daily spend remain intact. Renewal rechecks removal and creates an unsigned two-day permission requiring new grant-specific approvals; it never silently renews or starts trading.

Hardened installation inspection to reject other active member/role authority, including a re-enabled old member. Blocked valuation of unknown external buys when internal native-payment coverage is absent. Rehearsal status now shows the trusted receipt state and preserves known transaction hashes after interrupted responses. Recovery never converts an attempted request back into a retryable preparation.

Verification: 340 application tests passed; TypeScript and production build passed; 51 isolated real-runtime contract scenarios passed using fixture assets, including actual role removal and replacement installation. Live checks: 19 existing public/auth checks and 18 session-route authentication/cache/forged-identity checks passed. No live session grant, wallet signature, key loading or transaction broadcast was performed.

Independent review package: outputs/stock-steward-independent-review.zip. It includes exact sources, manifest, test source/evidence, pinned runtime snapshot, contract lab and review checklist. No external reviewer was contacted or selected; no genuine security, eligibility or funded-rehearsal approval has been supplied. Automatic trading remains compiled off. This work completes the bounded session replacement/recovery implementation, not a funded production validation or unrestricted continuous-autonomy release. Leftover ETH at an old session address is preserved, not automatically refunded; ciphertext backup retention and operational recovery need reviewer assessment.
