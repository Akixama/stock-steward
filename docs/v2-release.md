# Stock Steward v2 (branch `v2`)

Not deployed. Merge to `main` only after the owner checks below pass on a funded wallet.

## What v2 adds

1. **Referrals and points.** Invite links `/r/CODE`, 10 points per signup and 90 more when the friend verifies a wallet, an Invite card on Home and a public `/leaderboard`. Migration `0040_referrals.sql`.
2. **Automatic buying for every verified wallet.** `config/automatic-stages-release.json`: `autoBuy` and `approveByNotification` on for `*`, `requireIndependentReview: false`. Caps unchanged: $1 per trade, $2 per UTC day, $5 per two-day permission. The owner still signs the session permission, a fee limit and Start. Pause, revoke and both kill switches still apply. Owners who have not armed a session keep getting "Ready to buy" proposals.
3. **Automatic selling.** Real money → What to do → *Sell if the price drops to (stop-loss)* or *Sell when the price rises to (take profit)*. Setting up the session permission after saving a sell rule adds one fixed sale lot for that stock: the quantity is worth at most the rule amount (max $1) at the current price, and minimum USDG proceeds are encoded onchain (stop-loss 90% of the stop, take profit 97% of the target). Sales share the permission's trade quota. Sells never become proposals.

## Owner checks before merging

1. Deploy v2 to a preview, or apply migration 0040 and deploy.
2. Referral: open `/r/<your code>` in a private window, sign in as a new user, verify a wallet, and confirm your points go 0 → 10 → 100 and the leaderboard shows it.
3. Auto-buy: save a $1 buy rule whose price will trigger, set up the session permission, sign the fee limit and Start, fund the Safe with USDG and the session address with a little ETH. Confirm one automatic $1 buy lands in Activity with a receipt, then Pause and revoke.
4. Auto-sell: hold a little of a stock, save a take-profit rule just under the current price, set up a new permission (it must show a sale lot), Start, and confirm one automatic sale. Then Pause and revoke.

## Known limits

- No outside security review. Users are told this in the setup screen and Terms.
- The permission covers one sell rule's stock per session. Changing the sell rule needs a new permission.
- Sale floors are fixed when the permission is signed; a stock that falls more than 10% past the stop will not sell automatically.
