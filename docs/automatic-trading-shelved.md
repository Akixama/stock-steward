# Automatic trading: shelved for a later release

The public product currently supports Practice and wallet-approved real orders. Every real order requires the owner to review and approve the exact wallet transaction.

Automatic real-money trading remains in the repository as dormant implementation work. Its workspace panels, public Guide chapter and release copy are excluded from the current product. The former signed-in preparation routes, broker connection routes, background execution route, and setup panels are archived under `archive/automatic-trading`, so their old URLs return 404. `AUTOMATIC_TRADING_ENABLED` is source-gated to `false`, and the separate execution gate in `lib/autonomous-live.ts` remains `false`. The production background tick only runs Practice, read-only monitoring, and receipt reconciliation.

Before bringing it back:

1. fund and complete the bounded wallet rehearsal;
2. configure the market-news provider and operator alert destination;
3. obtain the independent security and account-eligibility evidence;
4. repeat the full verification suite against the exact release commit;
5. deliberately restore the archived routes and product surfaces, then deploy them with the reviewed release.

Do not enable the UI or executor from a hosting environment variable.
