# Bounded permission investigation — 27 September 2026

## Current implementation follow-up

The subsequent integration now compiles actual Roles conditions, quotas, membership and revocation calls, inspects installed state, and creates a protected wallet through the actual Safe factory in a local EVM. Thirty-seven scenarios passed using mainnet permission, wallet and swap-contract runtimes with fixture assets. See [spending permission implementation](spending-permissions.md) for current scope and remaining live gates. The investigation below records the earlier findings; no mainnet grant or trade has been installed.

## Earlier investigation result

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

### Follow-up: concrete Roles infrastructure found

The current official Zodiac deployment registry explicitly lists Robinhood Chain (4663) for Roles **2.1.1**. Version 2.1.0 is labelled vulnerable by that registry and must not be used. A read-only probe on 27 September 2026 at 17:19:27 UTC checked block `0x46adc44` and rechecked its canonical hash `0x10c3bd17a5e9b0a75e7da45a6e19cc4b45d5126e7edad591468548c69dd4f0fa`.

| Contract | Address | Runtime bytes |
| --- | --- | --- |
| Roles 2.1.1 | `0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5` | 24,409 |
| Integrity | `0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049` | 5,637 |
| Packer | `0x869718c939652084bc491fbc5ce0d3c1d5b309f0` | 2,138 |
| Module proxy factory | `0x000000000000aDdB49795b0f9bA5BC298cDda236` | 2,046 |

Presence and fingerprints are confirmed; source/runtime equivalence, compatible user avatar/account, installed policy and owner revocation remain unverified. Reproduce with `node --experimental-strip-types scripts/check-permission-infrastructure.mjs`; it reads private RPC configuration internally and never prints it. No transaction is submitted.

### Executable restriction specification

`lib/permission-policy.ts` now independently decodes a proposed router call rather than trusting the worker's route metadata. Its reference checks cover session/account/network, expiry/revocation, zero value and CALL only, exact command/action counts, the permitted stock output and USDG input, fixed pool fee/spacing and no hooks, matching exact settlement amount, positive output minimum, raw per-trade/remaining cumulative/remaining daily caps, and canonical ABI encoding at all nesting levels. The payout is fixed to the initiating account by the pinned TAKE_ALL action.

Adversarial fixtures exercise authority changes, command flags, extra actions, altered settlement/output, direction/hooks, malformed encodings and budget/expiry bypasses. A match ALWAYS returns `onchainEnforced: false` and `executionEnabled: false`. This specification is not an installed Roles condition tree, grant, audit, economic price/slippage guarantee or live spending integration. No HTTP grant endpoint was added.

The practical engineering candidate is a compatible avatar with Roles 2.1.1 and a scoped Universal Router function, with nested command restrictions and a shared raw-input allowance. The official allowance model is interval refill accounting, not automatically Stock Steward's UTC-day dollar accounting; an anchored refill timestamp and non-rolling ceiling need integration tests. Owner-configured membership/target/function revocation must also be tested through the real avatar. Broad `allowTarget`, wildcard `allowFunction`, alternate roles, unrestricted approvals and unwrappers can widen access and must be rejected by the installation review. No installer should be generated until these checks and the complete policy are verified.

Still unresolved: compatible avatar setup and its fees, complete nested condition compilation or custom verifier deployment, policy expiry enforcement, economic min-output bounds, oracle-backed USD/concentration accounting, actual module/account simulation, and end-to-end revocation. This improves the investigation but does not clear the spending activation gate.

Choose a permission implementation only after deployment and account compatibility are verified. Measure installation/delegation/revocation costs, validate command and token boundaries against malicious inputs, test revocation, then bind the owner-approved session and full delegated-account simulation. The owner must participate in granting authority; a watch-only address cannot do this.

Primary references:

- [Alchemy Wallet API permissions](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys)
- [Alchemy lower-level session installation](https://www.alchemy.com/docs/wallets/smart-contracts/modular-account-v2/session-keys/adding-session-keys)
- [Alchemy AllowlistModule source](https://github.com/alchemyplatform/modular-account/blob/develop/src/modules/permissions/AllowlistModule.sol)
- [Zodiac Roles conditions and limitations](https://docs.zodiac.eco/developers/roles/conditions)
- [EIP-7702 delegation format](https://eips.ethereum.org/EIPS/eip-7702)
- [Zodiac current deployments](https://docs.zodiac.eco/developers/roles/deployments)
- [Zodiac allowances and refill semantics](https://docs.zodiac.eco/developers/roles/allowances)
- [Zodiac target/function scoping and revocation](https://docs.zodiac.eco/developers/roles/permissions)
- [Zodiac custom condition integration requirements](https://docs.zodiac.eco/developers/roles/custom-conditions)

