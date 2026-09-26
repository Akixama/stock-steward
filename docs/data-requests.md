# Handling Stock Steward data requests

The signed-in `/account` page records a deletion request in `data_deletion_requests` under the site's owner ID and sign-in email. It does **not** immediately delete a mandate, receipt, broker token, or pending order. The support email remains available when the form is unavailable or a person has lost access to their sign-in. Never request a brokerage password, token, account number, or identity document by email.

## Operator workflow

1. Check the request queue regularly, including after deployment and support emails. Read `owner_ref`, `email`, `requested_at`, and `state` from `data_deletion_requests` where `state = 'requested'`. Record the request date and acknowledge it through the sign-in email. Follow the response period required in the user's applicable jurisdiction.
2. For an emailed request, verify that the sender controls the Stock Steward sign-in email and can provide the support ID shown on `/account`. A support ID in an email alone is not proof of identity. If there is doubt, ask the person to submit the signed-in request instead.
3. Check `account_order_gates` and the latest `order_events` for unresolved submissions. Reconcile any uncertain or pending broker order with Alpaca before removing its token or receipt. Do not interpret a missing response as an order rejection.
4. Document which local records can be erased and whether a specific legal, security, or dispute reason requires keeping a limited record. Tell the requester what will remain and why. Do not claim deletion from Alpaca or the hosting provider; those are separate services.
5. Revoke or remove the locally stored Alpaca token, erase eligible owner-bound mandates, receipts, order events, and order gates, then verify no eligible rows remain for that owner. Handle the request record itself according to the documented retention decision. Confirm the outcome to the requester through the sign-in email.

No automated operator notification or deletion worker exists yet. Until one is added, the queue and support inbox require manual review. The privacy notice must remain honest about this process.

Manual erasure must also remove owner-bound rows from `observations`, including embedded account snapshots, along with mandates, receipts and connections.

Erase `chain_observations` and `chain_read_gates` by the verified site owner_ref as part of manual workspace deletion. Watch-only addresses do not establish wallet ownership. Chain records include public addresses, balances, quotes and multipliers and must not be included in public support logs.
Autonomy readiness records in autonomy_runs and accounting rows in autonomy_spends are also owner-bound data. Before erasing future spending records, reconcile reserved, submitted or unknown intents and revoke any future wallet session. Current execution is inactive; readiness checks store public address, mandate version, infrastructure observations and pending prerequisites.
Pause and fence monitoring before owner-scoped erasure. Include autonomy_schedules, autonomy_worker_runs and chain_transaction_watches alongside observations and readiness receipts. Global worker health contains timestamps and aggregate counts.
Wallet-control messages, addresses, timestamps and verification methods in wallet_ownership are owner-bound records. Include them in access/deletion reviews. Raw ownership signatures are not persisted. Route evidence is stored inside autonomy_runs receipts and must be included in exports/erasure.
