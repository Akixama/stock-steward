# Robinhood Chain automatic-spending feasibility

Reviewed 26 September 2026. Automatic spending is **not implemented or enabled**.

## Most promising route: Alchemy Wallet APIs

Alchemy explicitly lists Robinhood mainnet and testnet for bundler, wallet APIs and gas sponsorship. Its session-key APIs support scoped permissions. The free platform tier advertises 30M compute units/month; gas sponsorship is not proof that gas is free for the operator. An API account/key is required. The operator does not yet have an account configured.

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
