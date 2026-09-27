# Execution preparation and release gates

Stock Steward's core goal is bounded autonomous action. The current release observes real mainnet data and prepares inspectable evidence, but does not sign or send Robinhood Chain transactions. These foundations are not a completed executor.

## Implemented without funds

- Exact candidate encoding for one USDG/stock zero-hook v4 swap, using Universal Router 2.1.2 and v4-periphery revision `545a5d2a87228167edde48f3b9eda122d1e3c4d6`. It fixes input, minimum output, pool, account, router and deadline. Local validation rejects any changed byte sequence, sender, target or native value.
- Authenticated route checks attempt a direct-router `eth_call` at the recorded block, compare the router code fingerprint, and recheck canonicality. A successful call may produce an execution-gas estimate. It is **not** a full delegated-account simulation or complete dollar fee quote. Reverts and missing evidence are shown honestly; no balance or allowance is fabricated with overrides.
- Exact integer accounting requires verified USD price bounds, full portfolio inventory, external activity, pending spend and fresh current-day evidence. It rounds proposed spend upward and reduces the concentration denominator for fees/loss. No live adapter yet establishes all these inputs; a stock subtotal cannot pass these requirements.
- An internal combined review binds accounting to the route account and block and compares candidate fingerprints. It always reports submission unavailable, even when test fixtures pass.
- Durable attempt storage atomically reserves daily budget, claims an attempt once, records uncertain/submitted outcomes, and retains reservations across midnight. Interrupted attempts become unknown, not retried. Only an unattempted reservation can be canceled without final chain evidence. A successful outer transaction is not a verified stock-token fill.

The database attempt APIs are internal and not invoked by a live signer or HTTP submission route. Terminal proof fields must come from a trusted chain reconciliation adapter, never a browser. A direct-router adapter is now implemented and wired to scheduled historical recovery; a delegated user-operation adapter is still required. Test fixtures establish code behavior, not successful wallet execution.

## Test together without spending

1. Open `/guide#testing` and save a mandate. Approval mode remains the default; automatic mode is an inactive preference.
2. Observe an example address. This does not prove ownership. Check coverage warnings, saved history and receipt downloads.
3. Select a browser wallet you actually control. Network switching and an optional ownership message are separate actions. Never enter a recovery phrase or private key into Stock Steward.
4. Inspect an AAPL route with a small exact USDG token amount. The result may quote and then revert due to missing funds/allowance; that is not an app failure or a filled trade. Review simulation state, fingerprints, expiry and explicit delegated-account limitation.
5. Check read-only monitoring, pause/resume and history. No permission or transaction prompt should appear in this walkthrough.
6. Share visible errors and the step where they appeared. Avoid including keys, signatures or provider credentials in screenshots.

Developer checks (Node 24):

```sh
node --experimental-strip-types --test lib/router-candidate.test.ts lib/router-simulation.test.ts lib/execution-accounting.test.ts lib/execution-review.test.ts db/execution-attempts.test.ts
node --experimental-strip-types scripts/check-router-simulation.mjs
```

The second command makes real read-only RPC calls, using private environment configuration. It prints a sanitized summary. It cannot spend funds.

## Required before any real-money activation

| Gate | Current gap |
| --- | --- |
| Wallet control | An owner must test the flow with their own wallet; example addresses are watch-only. |
| Eligibility | Country, token and venue eligibility must be established. RPC access does not establish trading eligibility. |
| Onchain authority | Demonstrate deployed restrictions on spend, output token, recipient, calldata, expiry and revocation together. An offchain validator does not constrain a compromised session key. Broad/root router authority is unacceptable. |
| Accounting | Supply verified USD price bounds and complete portfolio/external-activity evidence, not just tracked stocks. |
| Simulation | Simulate the complete delegated-account operation, including validation and gas/data/provider fees, against fresh evidence. |
| Budget | Obtain measured delegation, permission-installation and revocation estimates plus execution/data/provider costs under the user's cap. Gas price alone cannot establish a setup price. |
| Executor | Connect a verified signer/submission adapter with one-attempt semantics, pause fencing and durable reconciliation. |
| Fill proof | Validate the intended account, calldata, token transfers, actual input/output and canonical finalized outcome. Outer success alone cannot release or confirm spending. |
| Funded test | With explicit owner approval, test one small real operation, pause, rejection and revocation. |

Several gates require implementation or external verification even before funding. Money alone does not unblock autonomy. No paid deployment, funded operation or permission installation was performed in this release.

## Wallet-code, settlement and recovery update

Readiness checks now inspect canonical wallet code and any EIP-7702 delegation indicator. A documented target match remains insufficient to establish account implementation, ownership, installed session scope or revocation. Route receipts also combine observed settlement balance with the authenticated owner's private reservation ledger; missing raw reservation plans remain unknown. External activity and full USD valuation stay pending.

The scheduled worker recovers interrupted attempts without resubmission. Recorded direct-router transactions can be settled only after exact calldata, source/account, router code, canonical finalized inclusion and matching bounded token transfers are verified. Unsupported bundled operations, missing logs and changed evidence remain unresolved. It never sends a transaction. No user has performed a funded end-to-end test of this adapter.

See [permission investigation](permission-investigation.md) for verified facts and why activation remains blocked. Owner testing and funding are not substitutes for the remaining implementation and enforcement verification.

Primary implementation references: [Universal Router 2.1.2](https://github.com/Uniswap/universal-router/releases/tag/2.1.2), [pinned v4 router interface](https://github.com/Uniswap/v4-periphery/blob/545a5d2a87228167edde48f3b9eda122d1e3c4d6/src/interfaces/IV4Router.sol), [pinned action handling](https://github.com/Uniswap/v4-periphery/blob/545a5d2a87228167edde48f3b9eda122d1e3c4d6/src/V4Router.sol), [Alchemy session-key documentation](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys).
