# Autonomous trading: independent review brief

## Status

Not audited. Production unattended execution is compiled off in `lib/autonomous-live.ts`. Do not enable it based solely on passing application tests. No external reviewer has approved this release.

## Review scope

- Roles condition compilation, runtime pins, full event-history inspection, alternate roles and coactive spending authority.
- Safe owner authority, single module configuration, zero native value, MultiSend draft, session-key isolation and revoke-before-replace.
- Owner-scoped encrypted signer storage, AES-GCM authenticated context, rotation, key backup and incident handling.
- Complete asset inventory, token identities, indexed-history coverage, canonical blocks, timestamped USD bounds, eligibility and total network fees.
- Idempotent reservation, concurrent manual/autonomous orders, nonce collisions, pause races, UTC rollover, uncertain broadcast and crash recovery.
- Exact signed-envelope and fill proofs, outer-success/inner-failure distinction, terminal settlement and budget release.
- Auth, origin checks, cross-account access, grant drift, malicious transaction identifiers and stale updates.

## Evidence to inspect

Core: `lib/autonomous-executor.ts`, `lib/autonomous-session.ts`, `lib/autonomous-grant.ts`, `lib/autonomous-grant-proof.ts`, `lib/roles-installation.ts`, `lib/roles-permission.ts`, `lib/chain-fill-proof.ts`, `db/execution-attempts.ts`, `db/autonomous-transactions.ts`, `db/session-signers.ts`.

The permission lab runs real pinned contract bytecode in an isolated local EVM with fixture assets. It proves specific scenarios only; it is not a funded mainnet trial or independent audit.

## Required owner rehearsal after review

1. Review the separate session key, precise stock/amount/daily/total/expiry bounds and fee ceiling.
2. Approve the atomic bounded session grant personally in the wallet. Preserve the module-creation and grant transaction hashes.
3. Verify the exact owner transaction, current full condition tree, wallet owner, active membership and lack of alternate authority.
4. Perform a separately approved minimal funded execution, verify exact asset movements and receipt, then test pause, expiry and revocation.
5. Confirm no new intent can sign after pause or revoke; retain unresolved budgets during uncertain submissions.
6. Obtain written review findings and resolve them before a separate release decision enables the compiled spending gate.

## Open release blockers

Production adapters now provide canonical bounded inventory/history, timestamped token/USD pricing, exact account simulation and network fee estimates. Their coverage and performance require independent assessment. Unknown external buys fail closed without complete internal native-payment evidence; unsupported assets and stale quotes also block preparation. Genuine account eligibility, funded session lifecycle rehearsal and independent security approval remain required. The read-only preflight reports these gates; it never fabricates evidence or enables spending.

Session replacement now verifies current sole ownership and removed membership before atomically archiving the old grant. Unresolved purchases/account locks block replacement. Signer ciphertext, purchase evidence and daily spend are preserved. Fresh drafts rotate the session key and require new exact grant approvals. Review source: lib/session-retirement.ts, lib/session-renewal.ts, db/session-lifecycle.ts and db/session-rehearsal-recovery.ts. Permission inspection rejects any additional active member/role on the module. A paused or unknown purchase never becomes retryable through recovery.

In-app incident updates are implemented. Email/webhook/operator delivery is not configured and no messages have been sent to external parties.
