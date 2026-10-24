# Stock Steward v2 (branch `v2`)

Not deployed. Merge to `main` only after the owner checks below pass on a funded wallet.
Migrations to apply: `0040_referrals`, `0041_autonomous_setup_choices`, `0042_panic_guard`.

## What v2 adds

**Growth**
1. **Referrals and points.** Invite links `/r/CODE` give 10 points per signup and 90 more when the friend verifies a wallet. Home has an Invite card, and there is a public `/leaderboard` (chosen name or "Steward XXXX", never email or wallet).

**Automatic mode: a guardrail you set for yourself**
2. **Your Limits are the agent's limits.** Automatic trades use the owner's saved per-buy and per-day Limits, inside platform ceilings set in `config/automatic-stages-release.json`: $100 a trade, $500 a day and $15,000 per permission. The code allows at most $1,000, $5,000 and $50,000. The owner picks a permission length of 2, 7, 14 or 30 days. Owners who haven't turned it on keep getting "Ready to buy" proposals.
3. **One signature.** On the Automatic mode card, the owner chooses a length and a network fee limit, reads the permission in plain English, and signs one wallet transaction. Once that installation is verified on-chain (exact calldata, sender, success, factory provenance, found automatically), it counts as the fee and start approval. Pause, one-tap Resume and Remove permission all live on the same card. The older tools are under Advanced.
4. **Automatic selling.** The rule form adds *Sell if the price drops to (stop-loss)* and *Sell when it rises to (take profit)*. The permission then includes one fixed sale for that stock, with minimum proceeds written on-chain: 90% of the stop price, or 97% of the target.
5. **Panic guard.** Before every automatic trade, the account is valued at verified lower price bounds. A drop of 5, 10, 15 or 20% from its high, or an optional dollar loss since start, pauses automatic mode. A 6, 24 or 72 hour cool-off follows, and Resume is refused until it ends.
6. **Stress test.** Wall 1 is Steward's own checks: an oversize buy, an off-list stock, and a buy over the daily limit. Wall 2 is read-only `eth_call`s made as the session key against the live permission: draining USDG, approving a stranger, adding an owner, enabling a module, a double-size buy, and an off-list buy. Every attempt should read Refused, with the decoded reason.
7. **Replay.** Runs the rule in the form over the last 7 or 30 days of saved real prices. It shows every trade, the result, and a comparison with "all on day one" (for buys) or "just held" (for sells).

## Owner checks before merging

1. Deploy v2 to a preview and apply the three migrations.
2. **Referral:** open `/r/<code>` in a private window, sign up, and verify a wallet. Points should go 0 → 10 → 100, and the leaderboard should show it.
3. **Replay:** save any rule and press Replay. The summary and trades should make sense against the Markets chart.
4. **One-signature auto-buy:** save a buy rule that will trigger, choose 2 days and a fee limit, and sign once. The card should switch to "Steward is trading for you" by itself. Fund the Safe with USDG and the session address with a little ETH, then confirm one automatic buy lands in Activity with a receipt.
5. **Stress test:** run it. Every line should say Refused.
6. **Panic guard:** set it to 5%, check that the card shows the tracked high, and that Pause/Resume and the cool-off message behave.
7. **Auto-sell:** hold a little of a stock, save a take-profit just under the price, set up a new permission (it must mention the sale), and confirm one automatic sale.
8. Remove the permission and confirm in the wallet.

## Known limits

- No outside security review. Users are told this on the setup card and in the Terms.
- Deposits raise and withdrawals lower the value Panic guard sees. A withdrawal can trip it, which fails safe.
- One sell rule's stock per permission. Changing the sell rule needs a new permission.
- Sale floors are fixed at signing. A stock that falls more than 10% past the stop won't sell automatically.
- Replay ignores fees, slippage, and moves between saved prices.
