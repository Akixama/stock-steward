# Full release scope — October 12, 2026

The owner explicitly confirmed one release with all 12 strategy types trading real funds, including sells, news and rebalancing. The old approval-only launch checklist is historical evidence, not the current finish line.

## Actual capability coverage

| Capability | Implementation | Production evidence |
| --- | --- | --- |
| Wallet-approved purchase | Implemented | Existing finalized purchase |
| Scheduled and price-threshold autonomous buys | Bounded executor, accounting, permissions, controls and background integration implemented | Disabled pending independent review and funded separate-session lifecycle rehearsal |
| Pause, expiry, session removal and replacement | Implemented with isolated contract tests | Separate-session live wallet rehearsal pending |
| All 12 strategy types | Live decision planner implemented; reverse routes, explicit sale permission legs and stock sale accounting added | Full production integration, strategy consent, news account configuration, production feed wiring and complete lifecycle rehearsals remain incomplete |
| Operator alerts | Signed webhook outbox, bounded retries, persistent delivery records | Recipient and secret not configured; no external messages sent |
| UI and status | Centered navigation, readable strategy cards, execution outcomes and delayed-receipt alerts | Live UI checked; new release evidence recorded separately |

The 25–35% estimate given in chat was a rough estimate for bounded autonomous purchases. It is not evidence that all displayed practice strategies support real-money automation. The confirmed scope is all 12 strategy types. The earlier estimate is withdrawn; progress must be measured against this expanded implementation and verification checklist.

## Gates that cannot be satisfied by claiming more tests passed

- Genuine account eligibility decision and configured verifier address.
- Independent review of exact source, bounded grant, runtime pins, accounting/history coverage and encrypted signer recovery.
- Owner-approved separate session installation, funding, purchase, pause/expiry and revocation rehearsal.
- Review findings resolved and exact release evidence imported.
- Separately approved release enablement and owner start consent after those checks.
- Operator notification recipient approved and signing secret configured; test delivery acknowledged.

Automatic spending remains compiled off. The final enablement change must happen after review, not merely because implementation is present. Two-day session expiry and owner-approved replacement remain product constraints.

## Review request prepared, not sent

Subject: Stock Steward — scoped autonomous trading security review request

We seek an independent review of a Cloudflare-hosted application integrating Safe 1.4.1, Zodiac Roles, a separately encrypted session signer, and Robinhood Chain token purchases. The release scope covers all 12 strategies, including stock sales, allocation and portfolio rebalancing, and news triggers. The existing production adapter currently supports scheduled and threshold buys; the remaining strategies are under implementation. Please assess the complete application-to-contract flow: grant compilation and authority, RPC/indexer asset coverage, USD accounting and fee bounds, nonce/reservation concurrency, exact fill reconciliation, crash/unknown-broadcast recovery, pause/expiry/revocation/replacement, authentication and signer storage. Review must include the new sale permissions, input inventory reservations, bidirectional reconciliation, news authenticity and replay prevention, and portfolio sizing. The review package is not final until production integration is complete.

The attached review package contains exact source digest, source and tests, runtime snapshot, isolated contract lab, execution evidence and a rehearsal checklist. No live session trade or independent signoff has been completed. Please propose scope, exclusions, evidence/signoff format, schedule and price. Code changes invalidate the exact-source proof, so remediation and final release signing must be planned together.

Official intake options researched:
- https://www.openzeppelin.com/security-audits
- https://trailofbits.com/services/software-assurance/

No contact was made, no source was uploaded externally, and no payment was committed. The owner must choose the recipient and authorize sharing the package and any cost.


## Remaining implementation for the confirmed scope

- Persist a distinct real-money strategy selection and bind owner consent to its exact revision.
- Connect all 12 strategy decisions to fresh canonical inventory, reconciled history and verified price bounds in the production adapter.
- Configure and verify a provider account, wire the implemented Alpaca News adapter into live execution, and persist consumed article IDs. The owner confirmed no provider account exists yet. Practice headlines are insufficient evidence.
- Generate and review sale lots, stock allowances, output floors and expiries in the owner-signed grant flow.
- Wire sale accounting and per-token reservations into the live executor, recovery and UI.
- Enforce quoted post-trade allocation against actual output bounds, including rebalancing targets.
- Exercise buy and sell lifecycle failures, session renewal and revocation together in integration tests.
- Complete source review package, external review and owner wallet rehearsals before enabling automated spending.

The isolated contract lab now covers 56 scenarios including stock-to-USDG sale execution, proceeds recipient, changed amount, unauthorized caller, exact fill reconciliation and revocation. This proves those isolated contract paths; it does not establish production readiness for all 12 strategies.


## Verification of current implementation additions

- Full automated suite: 354 passing tests, plus two subsequently added news-adapter tests passing separately.
- Isolated actual-contract runtime lab: 56 passing scenarios; fixture funds only.
- TypeScript verification and production build logs are in outputs/full-release-typecheck.txt and outputs/full-release-build.txt.
- Full lint run: zero errors, 29 existing warnings; the subsequently added news adapter is checked separately.
- No live trade, wallet signature, provider purchase, external review engagement or deployment was performed for these all-strategy additions.

The new price-trigger planner uses underlying share price bounds; token input sizing uses token-value bounds including the shares-per-token multiplier. Attempting transactions remain reserved. Sale proceeds do not refund the buy budget, and pending sale quantities are recorded by input token.
