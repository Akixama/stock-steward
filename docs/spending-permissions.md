# Spending permission implementation

## What is implemented

The new integration compiles a narrow Zodiac Roles 2.1.1 policy for a compatible Safe wallet. `lib/roles-permission.ts` produces real factory, scope, quota, membership, execution-envelope and revocation calldata. It does not call a wallet, generate a session secret or broadcast any of these calls. Public installation and execution flags remain disabled.

The first policy intentionally uses **fixed-size raw USDG buys**, up to three approved output tokens, one owner-selected pool per token and an exact owner-set output minimum. The entire nested swap/settle/take parameter encoding is pinned. Only the deadline varies. Universal Router commands are exactly `0x10`, actions exactly `0x060c0f`, native value zero, operation CALL, and output goes to the initiating smart wallet. No worker token approval, ETH transfer, arbitrary recipient, alternate router, hook, delegatecall, wallet-administration or Roles-administration permission is included.

Daily and cumulative **call quotas** jointly meter those fixed-size buys. Raw budgets divide by the fixed input and round down; a remaining fraction cannot be spent. All approved outputs share the same quota keys. Daily refills have a UTC-midnight anchor and a one-day ceiling, without unused budget accumulating. The total quota does not refill. `startsAt` is the accounting anchor, not an independently enforced future activation date; installation must be reviewed during its current interval. A router deadline strictly before the absolute policy expiry prevents successful execution once that expiry passes, provided the reviewed router implementation enforces its deadline. This is tested both with a router fixture and the actual mainnet Universal Router runtime in a local EVM. A live account and route still need current verification.

The module belongs to the smart wallet itself. Its owner can revoke the worker's membership. Revocation, depleted quotas and inner-call failure are exercised through real permission contracts in an isolated EVM. A fresh grant has separate keys, so reconfiguration must first revoke the old grant; otherwise two owner-authorized grants can coexist and their budgets add. No live installer is exposed until that lifecycle review is wired.

## Contract-level verification

`permission-lab` loads canonical mainnet runtime snapshots for Roles, Integrity, Packer, Module Proxy Factory and the ERC-2470 factory used for condition storage. Every loaded runtime must match a pinned fingerprint. It loads the verified Safe 1.4.1 singleton and factory runtimes, creates an owner-only wallet through the actual Safe factory, checks its predicted address, deploys a Roles proxy through the actual module factory, and uses local owner-approved Safe transactions to configure it.

The normal mode uses a router test double. The `--actual-router` mode uses actual mainnet Universal Router, Permit2 and PoolManager runtimes on an isolated Cancun EVM. Settlement tokens, stock tokens and pool liquidity are explicitly **local fixtures** in both modes. All 37 scenarios passed in the actual-router mode. These tests establish mechanical permission behavior through the wallet and permission contracts; they do not establish a successful mainnet Uniswap trade, current stock prices, region eligibility, actual wallet compatibility, source audit, economic slippage guarantees or affordable setup fees. No real wallet private key, mainnet write or real funds are used.

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

## Still required before a live grant

1. Verify the actual owner's wallet/account setup on Robinhood Chain and review its implementation and deployment provenance.
2. Verify actual router and Permit2 behavior through that account, with bounded owner-controlled approvals. The worker cannot create approvals.
3. Measure complete creation, configuration, approval, execution and revocation costs, including chain data and provider fees, against the user's cap.
4. Bind the owner-confirmed policy to the saved mandate and encrypted session signer; revoke old grants before replacing them.
5. Connect live USD valuation, concentration, outstanding-spend accounting and exact execution receipts. Raw token quotas do not enforce dollars or portfolio allocation.
6. Obtain the owner's explicit signature for any paid installation or spending authorization, then perform a small funded execution and revocation test.

The code integration is progress beyond the earlier JavaScript-only reference decoder. It does **not** mean the public app already has a spending grant or that only funding remains.

Primary references: [Roles contract interface](https://docs.zodiac.eco/developers/roles/reference), [allowances](https://docs.zodiac.eco/developers/roles/allowances), [current deployment registry](https://docs.zodiac.eco/developers/roles/deployments), [official Roles source](https://github.com/gnosisguild/zodiac-modifier-roles), [Safe contracts](https://github.com/safe-global/safe-smart-account).

