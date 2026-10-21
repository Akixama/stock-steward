# Automatic trading: shelved for a later release

The public product currently supports Practice and wallet-approved real orders. Every real order requires the owner to review and approve the exact wallet transaction.

Automatic real-money trading remains dormant in the current production version. A later review branch stages Shadow receipts and two further default-off flags; see [automatic-stages-review.md](automatic-stages-review.md). No automatic stage has been deployed from that branch. The former session-grant setup routes and panels remain archived under `archive/automatic-trading`, so a new user cannot grant autonomous spending from the live workspace.

Before bringing it back:

1. fund and complete the bounded wallet rehearsal;
2. configure the market-news provider and operator alert destination;
3. obtain the independent security and account-eligibility evidence;
4. repeat the full verification suite against the exact release commit;
5. deliberately restore the archived routes and product surfaces, then deploy them with the reviewed release.

Do not enable the UI or executor from a hosting environment variable.
