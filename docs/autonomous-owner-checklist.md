# Stock Steward: next steps for the separate session pilot

**Archived future-release checklist.** The owner chose to shelve automatic real-money trading. The advanced automation and session-review controls named below are not present in the current product, and these steps cannot be completed on stocksteward.app today. See [the current release boundary](automatic-trading-shelved.md). The current real-order path requires wallet approval for each exact purchase. No separate session permission, funded session purchase or external signoff has been completed.

## Before wallet installation

1. Open https://stocksteward.app/workspace and sign in. Connect the owner wallet that owns the Steward Safe.
2. In the advanced automation section, save the intended preview rule and review the mandate. This session pilot requires an automatic execution preference in the saved mandate, but that preference alone cannot start trading.
3. Review or create the separate session draft. It stores an encrypted session key, never your owner key, and grants nothing until you sign installation. Review its Safe, allowed stock tokens, raw amount ceilings, minimum outputs and expiry.
4. In Release checks, approve your maximum network fee per purchase. This is a free message signature; it does not start trading.
5. Obtain genuine signed eligibility and security decisions for the exact account, policy and source digest. Configure the reviewers' public addresses in STEWARD_AUTONOMY_REVIEW_AUTHORITIES and import their evidence. These are external requirements; a user checkbox or test result cannot replace them. Refer to autonomous-security-review.md and the generated outputs/autonomous-review-manifest.json.

## Only after those reviews pass

6. Choose Check rehearsal access, then Review session installation in wallet. This owner transaction replaces the old purchase role with the separate bounded session role. Review it in your wallet. Do not approve a transaction that your wallet says is likely to fail.
7. Enter the Roles module creation transaction and session installation transaction under Verify the confirmed installation. Choose Verify onchain permission.
8. Run the read-only rehearsal. Fund the **Steward Safe** with the required USDG only if you intend the reviewed purchase. The **separate session address** needs a small amount of ETH for its own maximum network fee. These are different addresses. Keep owner ETH for installation and revocation. No transfer is performed automatically.
9. Prepare one purchase. Review the exact approval and select Approve this real purchase only if you intend that spend. The server submits at most one signed session transaction for this intent. The quote expires quickly; an expired quote requires a fresh preparation and fresh approval. This does not turn on automatic trading.
10. Check submitted purchases and the incident/receipt records. Submission is not proof of a stock fill. Unknown responses retain their transaction hash, account lock and budget until exact receipt reconciliation. Never send another purchase to recover a lost response.
11. Choose Pause and revoke session permission and approve the owner wallet transaction. Server purchases are paused first; onchain removal requires successful wallet execution and chain verification. Submitted purchases may still complete. Check the actual session role membership, not a stale earlier verification table.

## Release work that remains

An independent reviewer must verify the actual session buy, expiry/pause behavior and revocation before providing the funded rehearsal evidence. Automatic launch also requires a reviewed release change and a separate owner start approval. The current build deliberately cannot arm automatic purchases.

Each session remains bounded to two days. To replace it, first revoke its role in your owner wallet, then choose Verify removal and archive session under Session review. Current owner/runtime/membership proof and resolution of every purchase are required. Funds, encrypted signer backups and spending history are retained; this does not refund leftover session ETH. Prepare unsigned draft then creates a fresh key and period for the same Safe and unchanged mandate. New grant-specific reviews, fees, installation and start approval are required. Shared daily spend is retained across renewal. Automatic renewal without owner approval is not supported.

Reviewers must assess asset discovery coverage, native/internal transfers, historical spend classification, long RPC scans, quote expiry and unknown transaction recovery. Unrecognized external buys are blocked when internal native-payment coverage is missing; the indexer cannot silently establish that proof. Passing application tests does not establish independent security approval or account eligibility.
