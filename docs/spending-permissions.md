# Spending permission implementation

## What is implemented

The new integration compiles a narrow Zodiac Roles 2.1.1 policy for a compatible Safe wallet. `lib/roles-permission.ts` produces real factory, scope, quota, membership, execution-envelope and revocation calldata. It does not call a wallet, generate a session secret or broadcast any of these calls. Public installation and execution flags remain disabled.

The first policy intentionally uses **fixed-size raw USDG buys**, up to three approved output tokens, one owner-selected pool per token and an exact owner-set output minimum. The entire nested swap/settle/take parameter encoding is pinned. Only the deadline varies. Universal Router commands are exactly `0x10`, actions exactly `0x060c0f`, native value zero, operation CALL, and output goes to the initiating smart wallet. No worker token approval, ETH transfer, arbitrary recipient, alternate router, hook, delegatecall, wallet-administration or Roles-administration permission is included.

Daily and cumulative **call quotas** jointly meter those fixed-size buys. Raw budgets divide by the fixed input and round down; a remaining fraction cannot be spent. All approved outputs share the same quota keys. Daily refills have a UTC-midnight anchor and a one-day ceiling, without unused budget accumulating. The total quota does not refill. `startsAt` is the accounting anchor, not an independently enforced future activation date; installation must be reviewed during its current interval. A router deadline strictly before the absolute policy expiry prevents successful execution once that expiry passes, provided the reviewed router implementation enforces its deadline. This is tested both with a router fixture and the actual mainnet Universal Router runtime in a local EVM. A live account and route still need current verification.

The module belongs to the smart wallet itself. Its owner can revoke the worker's membership. Revocation, depleted quotas and inner-call failure are exercised through real permission contracts in an isolated EVM. A fresh grant has separate keys, so reconfiguration must first revoke the old grant; otherwise two owner-authorized grants can coexist and their budgets add. No live installer is exposed until that lifecycle review is wired.

## Contract-level verification

`permission-lab` loads canonical mainnet runtime snapshots for Roles, Integrity, Packer, Module Proxy Factory and the ERC-2470 factory used for condition storage. Every loaded runtime must match a pinned fingerprint. It loads the verified Safe 1.4.1 singleton and factory runtimes, creates an owner-only wallet through the actual Safe factory, checks its predicted address, deploys a Roles proxy through the actual module factory, and uses local owner-approved Safe transactions to configure it.

The normal mode uses a router test double. The `--actual-router` mode uses actual mainnet Universal Router, Permit2 and PoolManager runtimes on an isolated Cancun EVM. Settlement tokens, stock tokens and pool liquidity are explicitly **local fixtures** in both modes. All 44 scenarios passed in the actual-router mode. These tests establish mechanical permission behavior through the wallet and permission contracts; they do not establish a successful mainnet Uniswap trade, current stock prices, region eligibility, actual wallet compatibility, source audit, economic slippage guarantees or affordable setup fees. No real wallet private key, mainnet write or real funds are used.

Run:

```powershell
node --experimental-strip-types scripts/check-permission-infrastructure.mjs --snapshot
cd permission-lab
npm ci --ignore-scripts --no-audit --no-fund
cd ..
node --experimental-strip-types permission-lab/test.mjs
node --experimental-strip-types permission-lab/test.mjs --actual-router
```

The first command reads the privately configured RPC and saves only public contract bytecode in ignored `outputs/permission-runtime.json`. The lab itself performs no network requests. Results are saved as `outputs/permission-lab-result.json` and `outputs/permission-swap-lab-result.json`. `lib/safe-setup.ts` compiles owner-only factory creation calldata; no setup is broadcast. Development dependencies are isolated from the application dependency manifest.

## Installed-state reader

`lib/roles-installation.ts` inspects the module and wallet at one canonical block. It checks runtime fingerprints, a supported proxy/singleton, module ownership/avatar/target, a single non-session wallet owner, the expected wallet module, empty guard/fallback configuration, factory creation provenance, complete bounded configuration history, exact conditions, no additional worker role, no wildcard/alternate target or selector, no transaction unwrapper, and both current quotas.

Unavailable, changed, oversized or incomplete evidence blocks the check. This reader supports only the narrowly tested wallet configuration. It is not an arbitrary smart-wallet adapter. A verified policy state still has `walletOwnershipVerified: false` and `executionEnabled: false`: the caller must separately bind the wallet owner's verified control and current mandate, obtain full account/router simulation and economic evidence, reconcile outstanding attempts, check fees and eligibility, and connect a reviewed signer adapter. Client-supplied booleans must never replace these checks.

## Live setup-cost quote (6 October 2026)

`node --experimental-strip-types scripts/quote-setup-fees.mjs` prices the permission-lab gas evidence with live chain fee data and a live ETH/USD upper bound. It is read-only and sends no transaction. The lab now records its six measured components to `outputs/setup-fee-gas.json`; the quote writes `outputs/setup-fee-quote.json`.

Measured on 6 October 2026 at block `0x4dfe3e2`: total 2,145,895 gas across wallet creation (236,836), module creation (235,723), permission installation (1,109,527), token approvals (146,400), one execution (355,202) and revocation (62,207). The fee ceiling was twice the observed network gas price (0.0405 gwei) and the ETH/USD bound was the Binance ETHUSDT 24-hour high plus 1% ($2,752.38), cross-checked against the CoinGecko USD spot within 3%. The guarded maximum is **$0.24 against the $20 cap**, leaving wide margin even though this chain's gas price is unusually low.

The caveats are part of the quote: gas units come from the isolated lab with a two-output fixture policy and an exact policy may differ; provider fees are recorded as zero on a compute-unit-billed plan with no assumed gas sponsorship. Chain data (L1 poster) fees are now measured, not omitted: the lab records each component's calldata byte composition and the quote prices it at 16 gas/nonzero byte and 4 gas/zero byte against the chain's own `getL1BaseFeeEstimate()` (ArbGasInfo), reported in `dataFeeStatus` (`measured-zero`, `measured-upper-bound`, `recorded-separately-not-included` or `unmeasured`). On 7 October 2026 the estimate measured zero — the chain currently posts data for free — so the guarded maximum stayed at $0.24 against the $20 cap with data fees included at zero; recheck the floating estimate before owner signing. This is review evidence, not a spending authorization.

## Still required before a live grant

1. Verify the actual owner's wallet/account setup on Robinhood Chain and review its implementation and deployment provenance.
2. Verify actual router and Permit2 behavior through that account, with bounded owner-controlled approvals. The worker cannot create approvals.
3. Measure complete creation, configuration, approval, execution and revocation costs, including chain data and provider fees, against the user's cap. A first live quote now exists (see below); chain data and provider fees still need explicit measurement, and fresh evidence must be rechecked before owner signing.
4. Bind the owner-confirmed policy to the saved mandate and encrypted session signer; revoke old grants before replacing them. `lib/policy-lease.ts` now binds the exact compiled policy to a mandate digest and the stored signer reference, and refuses a coactive grant, mandate drift, stale bindings and revocations that are not the exact revoke call. The enforcement wrapper now exists dormant: lib/submission-adapter.ts (one-attempt submission with switch + pause fences, exact owner approval required, lease and mandate-drift checks, dollar-accounting review, atomic single reservation and durable unknown states that are never retried) and db/session-signers.ts (AES-GCM encrypted session-signer records whose material loads only inside the adapter). Neither is reachable from any HTTP route or worker; activation still needs the live installer wired to the lease check and the signer wired to a reviewed submission path.
5. Connect live USD valuation, concentration, outstanding-spend accounting and exact execution receipts. Raw token quotas do not enforce dollars or portfolio allocation. `lib/live-accounting.ts` now assembles the complete evidence set (two-sided verified USD price bounds, full inventory, classified external activity including external buys counted against the daily ceiling) from injectable read-only sources, or reports named gaps and refuses. Probe it with `node --experimental-strip-types scripts/check-live-accounting.mjs --address 0x… --target AAPL`; it demonstrated a complete zero-gap assembly on an empty predicted Safe address on 6 October 2026. Remaining gaps at activation: production wiring of the Alchemy transfer/balance sources into the worker, an owner ledger file, and the provider history-coverage assumption (the probe caps pagination and fails closed).
6. Obtain the owner's explicit signature for any paid installation or spending authorization, then perform a small funded execution and revocation test.

The code integration is progress beyond the earlier JavaScript-only reference decoder. It does **not** mean the public app already has a spending grant or that only funding remains.

Primary references: [Roles contract interface](https://docs.zodiac.eco/developers/roles/reference), [allowances](https://docs.zodiac.eco/developers/roles/allowances), [current deployment registry](https://docs.zodiac.eco/developers/roles/deployments), [official Roles source](https://github.com/gnosisguild/zodiac-modifier-roles), [Safe contracts](https://github.com/safe-global/safe-smart-account).

