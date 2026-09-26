# Robinhood Chain automatic-spending feasibility

Reviewed 26 September 2026. Automatic spending is **not implemented or enabled**.

## Most promising route: Alchemy Wallet APIs

Alchemy explicitly lists Robinhood mainnet and testnet for bundler, wallet APIs and gas sponsorship. Its session-key APIs support scoped permissions. The free platform tier advertises 30M compute units/month; gas sponsorship is not proof that gas is free for the operator. An API account/key is required. The operator has created a Stock Steward Alchemy app and enabled Robinhood mainnet and testnet. The API key is configured outside the source checkout. Authenticated read-only RPC access has been verified on both networks.

- Network support: https://www.alchemy.com/docs/wallets/supported-chains
- Permissions: https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys
- Pricing: https://www.alchemy.com/pricing

Use existing audited account implementations rather than deploying a bespoke spending contract. Do not copy the SDK guide's root-permission example: it grants far more power than Steward requires. An EIP-7702 delegation changes account authority and requires informed owner approval. It is not an ordinary sign-in signature.

## Required before implementing spending

1. Configure a free Alchemy app, restricted to the required network/origins; keep operator credentials out of public source.
2. Validate testnet behavior: token-specific spend cap, expiry, target/function allowlist, exact router recipient, output token and revocation. Prove that transfers, arbitrary calls, unlimited approval, extra recipients and malicious calldata are rejected.
3. Verify an execution venue and route for the intended stock tokens. Bound slippage, gas, liquidity and permit/allowance scope. Spending a stablecoin within a cap does not enforce concentration or establish a good trade.
4. Choose secure session-key storage and a worker with durable daily accounting and idempotent transaction reconciliation. Never request the owner's seed phrase/private key.
5. Obtain exact estimates for delegation/account setup, permission installation and revocation. Convert the estimate using an identified ETH/USD source, include provider fees and a buffer, and refuse setup if it exceeds the user's selected $10–$20 cap. Do not infer cost from generic L2 averages.
6. Run the same policy tests on the actual deployed account before enabling a funded trial. No deployment or trade occurs merely because a provider supports the network.

Current conclusion: supported candidate found, but end-to-end feasibility and the $20 mainnet setup budget remain **unverified**. No funded wallet, configured provider, exact route or live user-operation estimate has been supplied. Continue the read-only/user-approved web-steward work while this is resolved.

## Alternative checked: ZeroDev

ZeroDev lists Robinhood 4663 and testnet 46630, and supports call policies/session keys. Its advertised hosted Sandbox is testnet-only at $0/month; Launch is $69/month with production access. That hosted plan does not match the current budget. A self-hosted SDK/bundler architecture would require separate verification and is not claimed to be free.

- https://docs.zerodev.app/api-and-toolings/faqs/chains
- https://www.zerodev.app/pricing
- https://docs.zerodev.app/smart-accounts/permissions/policies/call

Read-only mainnet probe confirmed bytecode at the documented Alchemy SMA-7702 v1.1.0 delegate `0x77021100bD87b7008E5E1989d0eB38555d0d0000` (24,358 bytes). The public RPC returned gas price `0x1ab2f60` during the probe. This is not a user-operation fee estimate: gas usage, data charges, permission installation and provider fees still need measurement. Bytecode presence alone does not verify the entire policy path.


## Private RPC connection check

Save the existing app API key in `private-config/alchemy-credentials.json`, outside this source checkout, as `{"apiKey":"your-key"}`. Never paste it into chat or public source. Run `node scripts/check-alchemy.mjs` from the checkout. Alternatively supply `ALCHEMY_API_KEY` through the local environment. The script checks chain IDs, current blocks and gas prices for both networks and sanitizes connection failures. It sends no transactions, grants no permissions and does not establish a total setup fee. Syntax validation and the missing-key guard have been checked. Authenticated RPC checks passed on 26 September 2026: mainnet chain ID 4663, block 73226233, gas price 28232000 wei; testnet chain ID 46630, block 124706850, gas price 10000000 wei. These gas prices are observations, not total transaction fees. No transaction was submitted.


## Execution investigation and implemented foundation

Official Uniswap deployments list Robinhood Universal Router 2.1.2 at 0x204FAca1764B154221e35c0d20aBb3c525710498 and Permit2 at 0x000000000022D473030F116dDEE9F6B43aC78BA3. Read-only mainnet probe on 26 September 2026 returned 24,380 bytes of router code, 9,152 bytes of Permit2 code and 24,358 bytes of delegate code at block 0x45d7f8c. Code presence does not prove token-pair liquidity or runtime correctness.

Reference: https://developers.uniswap.org/docs/protocols/v4/deployments

The workspace readiness API now persists blocked receipts per signed-in owner. The reservation core atomically rejects duplicate intents and excessive daily spend, retaining unresolved reservations across midnight. It is tested on SQLite, but is not wired to a live executor. The fee guard requires all three measured setup stages plus explicit data/provider fees and fresh ETH/USD evidence, adds 50% headroom, and rejects a budget over $20. No actual complete quote has been obtained.

Important permission blocker: Alchemy documents ERC20 spending, gas and contract/function permissions, but broad Universal Router access does not itself establish recipient/output-token restrictions or safe command handling. Do not combine an ERC20 cap with router access and claim the cap applies to arbitrary router calls without testing the permission semantics. Root grants are forbidden. A constrained existing permission policy or audited execution adapter may be needed; that choice and its deployment cost remain pending.

Stock-token eligibility remains separate from wallet/RPC access. Official Robinhood documentation excludes U.S. persons and lists other jurisdiction restrictions. Nigeria eligibility has not been established by this work. No regional bypass is proposed.
Durable read-only monitoring now has leases, retry IDs, pause fencing and a three-failure circuit breaker. Runner activation requires separate credential configuration and verification. Transaction reconciliation never authorizes spending, releases reservations or resubmits a transaction.

## Verified direct-route evidence and remaining permission blocker

Read-only mainnet probe on 26 September 2026 at block 0x45dff27 returned an AAPL/USDG zero-hook Uniswap v4 quote: input 1 USDG (1000000 units), output 2924378508115670 raw AAPL units, fee 3000, tick spacing 60, active liquidity 2703137059450940245, quoter gas 43256. The 1% pool also quoted; the 0.05% key had no active liquidity and the 0.01% key was uninitialized. This is a historical read-only probe using a public burn address, not a user's funded execution. Search coverage is four fixed direct pool keys only. Output and gas values are not current trading offers or complete fee estimates.

References: https://docs.robinhood.com/chain/contracts/ and https://developers.uniswap.org/docs/protocols/v4/deployments . Router source-version inspection through the explorer API was blocked by its challenge page; no bypass was attempted. Full transaction calldata/simulation remains unverified. A safe narrow enforcement module or audited adapter that inspects router arguments is still needed before any automatic session grant. The internal application guard cannot substitute for that onchain enforcement.

Implemented ownership challenge/replay checks, direct quoter inspection, and internal execution preflight tests. Live wallet ownership has not been tested by the owner yet. Eligibility, complete setup fees, deployed permission/revocation tests, signing and funded execution remain pending. The read-only GitHub runner was verified and enabled separately; it submits no trades.
