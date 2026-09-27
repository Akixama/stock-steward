# Bounded permission investigation — 27 September 2026

## Result

No ready-to-activate Robinhood Chain permission path has been verified to enforce all Stock Steward invariants without additional account configuration, installation and testing. The standard Alchemy Wallet API remains useful infrastructure, but broad router access is not sufficient. No root grant, permission installation, signing request or paid deployment was performed.

## Paths investigated

| Path | Evidence | Remaining gap |
| --- | --- | --- |
| Standard Alchemy Wallet APIs | Documented token spend/approval cap, gas, expiry and target/function permissions. | No documented nested-router argument constraints establishing recipient, output token and allowed command structure together. |
| Alchemy Modular Account V2 | Official lower-level session installation supports custom validation and hook wiring. | Requires a compatible account, validated policy implementation, installation costs and testing. An address or selector allowlist does not decode a router's internal swap commands. |
| Zodiac Roles Modifier | Official conditions support nested ABI data, equality, array restrictions and allowances. | A candidate for further engineering, not an integrated solution. Robinhood deployment, account compatibility, complete command restriction, atomic budget semantics, revocation and full setup costs remain unverified. |

Review of Alchemy's current AllowlistModule source shows spend accounting for direct token transfer/approval calls and address/selector checks on targets. This is evidence about that source, not proof of the exact deployed Robinhood account implementation. It must not be treated as enforcing spend/output restrictions inside arbitrary router calls.

The direct-router candidate limits one exact-input v4 call in application code. A compromised signer could bypass application checks unless the installed account policy independently constrains the operation. This remains an activation gate. Complete dollar, daily and allocation promises also require reliable live accounting; raw token caps alone do not establish dollar limits.

## What the release can verify now

The authenticated read-only wallet inspector classifies empty code, contract code and the exact EIP-7702 delegation indicator at a canonical block. For delegation, it reads the target code and records its fingerprint. Matching the documented Alchemy address establishes only an address match, never installed session authority, audited bytecode, current signer scope or revocation behavior.

The scheduled worker can recover historical direct-router attempts and reconcile exact finalized calldata plus token-transfer bounds. It has no signer or submission capability. Bundled user operations require a separate validated envelope and event path; outer transaction success is not sufficient.

## Next activation gate

Choose a permission implementation only after deployment and account compatibility are verified. Measure installation/delegation/revocation costs, validate command and token boundaries against malicious inputs, test revocation, then bind the owner-approved session and full delegated-account simulation. The owner must participate in granting authority; a watch-only address cannot do this.

Primary references:

- [Alchemy Wallet API permissions](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys)
- [Alchemy lower-level session installation](https://www.alchemy.com/docs/wallets/smart-contracts/modular-account-v2/session-keys/adding-session-keys)
- [Alchemy AllowlistModule source](https://github.com/alchemyplatform/modular-account/blob/develop/src/modules/permissions/AllowlistModule.sol)
- [Zodiac Roles conditions and limitations](https://docs.zodiac.eco/developers/roles/conditions)
- [EIP-7702 delegation format](https://eips.ethereum.org/EIPS/eip-7702)
