# Stock Steward v2 (branch `v2`)

Not deployed. Merge to `main` only after the owner checks below pass on a funded wallet.
Migrations to apply: `0040_referrals`, `0041_autonomous_setup_choices`, `0042_panic_guard`, `0043_multiple_rules`, `0044_ai_agent`, `0045_memecoin_market_cache`, `0046_memecoin_price_samples`.
The scheduler cron is now every minute (`* * * * *`): sell rules check each minute, the full monitor still runs every 15.

## v2 scope

Terms updated (`2026-10-26-agent-v2`): owners re-accept before their next trade. "Advanced tools" under Automatic mode are hidden with the v3 extras.

Shown in v2: the Steward agent (two modes, report card), auto-sell (stop-loss, take-profit, trailing stop; one rule), one-signature setup, Panic guard, gas handling.

Hidden for v3 behind `V3_EXTRAS` in `lib/product-flags.ts` (screens and APIs off, code and tests kept): several rules, Replay, Stress test, Steward suggests, referrals and the leaderboard. Owner checks for those are skipped in v2.

## What the branch contains

**Growth**
1. **Referrals and points.** Invite links `/r/CODE` give 10 points per signup and 90 more when the friend verifies a wallet. Home has an Invite card, and there is a public `/leaderboard` (chosen name or "Steward XXXX", never email or wallet).

**Steward agent (the headline)**
0. **An AI agent that trades for you.** The owner picks up to 6 stocks from their Limits, a style (careful, balanced, bold), how often it checks (15 min to 4 hours) and an optional note. Each check, the AI sees prices, 1-day and 7-day moves, holdings and cash (never addresses) and chooses buy, sell or hold with a one-line reason. Fixed code then checks it: listed stock, fresh price, enough USDG, a sale lot in the permission, and no chasing (careful won't buy after a 5% day, balanced after 15%). An approved decision becomes a one-shot rule and goes through the same execution path as every automatic trade: Panic guard, gas, daily caps, the on-chain permission. A hold, a bad answer or an AI outage parks it. Every decision is logged on the card with its reason. One trade = the owner's per-buy Limit. The permission adds one sale per agent stock (85% floor of the day's low price).

- **Two modes, one switch.** *Agent trades for me*: trades through the one-signature permission. *Ask me first*: needs no permission at all; buy calls arrive as Ready to buy ideas (inbox + push) that the owner signs or skips, and sell calls arrive as inbox ideas to sell from Home.
- **Model and headlines.** Decisions use OpenAI's open-weight gpt-oss-120b on Workers AI, falling back to llama-3.1-8b if it fails. When a news account is configured (`STEWARD_NEWS_*`), the agent also sees up to 3 headlines per stock from the last 24 hours, as data only.
- **Report card.** "8 of 12 calls right so far, average +1.4% since each call", scored against current prices (calls under an hour old are skipped).

**Automatic mode: the guardrail around it**
2. **Your Limits are the agent's limits.** Automatic trades use the owner's saved per-buy and per-day Limits, inside platform ceilings set in `config/automatic-stages-release.json`: $100 a trade, $500 a day and $15,000 per permission. The code allows at most $1,000, $5,000 and $50,000. The owner picks a permission length of 2, 7, 14 or 30 days. Owners who haven't turned it on keep getting "Ready to buy" proposals.
3. **One signature.** On the Automatic mode card, the owner chooses a length and a network fee limit, reads the permission in plain English, and signs one wallet transaction. Once that installation is verified on-chain (exact calldata, sender, success, factory provenance, found automatically), it counts as the fee and start approval. Pause, one-tap Resume and Remove permission all live on the same card. The older tools are under Advanced.
4. **Automatic selling.** The rule form adds *Sell if the price drops to (stop-loss)* and *Sell when it rises to (take profit)*. The permission then includes one fixed sale for that stock, with minimum proceeds written on-chain: 90% of the stop price, or 97% of the target.
5. **Panic guard.** Before every automatic trade, the account is valued at verified lower price bounds. A drop of 5, 10, 15 or 20% from its high, or an optional dollar loss since start, pauses automatic mode. A 6, 24 or 72 hour cool-off follows, and Resume is refused until it ends.
6. **Stress test.** Wall 1 is Steward's own checks: an oversize buy, an off-list stock, and a buy over the daily limit. Wall 2 is read-only `eth_call`s made as the session key against the live permission: draining USDG, approving a stranger, adding an owner, enabling a module, a double-size buy, and an off-list buy. Every attempt should read Refused, with the decoded reason.
7. **Replay.** Runs the rule in the form over the last 7 or 30 days of saved real prices. It shows every trade, the result, and a comparison with "all on day one" (for buys) or "just held" (for sells).
8. **Several rules.** Up to 6 rules side by side (for example buy NVDA on dips, stop-loss on TSLA). Each one pauses, edits and removes on its own. The old single rule becomes "main".
9. **Trailing stop.** Sell when the price falls a chosen percent from its high since the rule started.
10. **Faster checks.** Sell rules can check every minute.
11. **Gas handled.** A Gas card shows the session key's ETH in dollars and tops it up for about 10 trades in one tap. Steward pauses trading when gas runs out and warns when it's low.
12. **Steward suggests.** The AI proposes up to 3 rules from your stock list and recent prices. Each one is clipped to your Limits, kept within 30% of the price, replayed, and saved paused, so nothing runs until you turn it on.

## Owner checks before merging

1. Deploy v2 to a preview and apply migrations 0040 to 0043.
2. **Referral:** open `/r/<code>` in a private window, sign up, and verify a wallet. Points should go 0 → 10 → 100, and the leaderboard should show it.
3. **Replay:** save any rule and press Replay. The summary and trades should make sense against the Markets chart.
4. **One-signature auto-buy:** save a buy rule that will trigger, choose 2 days and a fee limit, and sign once. The card should switch to "Steward is trading for you" by itself. Fund the Safe with USDG and the session address with a little ETH, then confirm one automatic buy lands in Activity with a receipt.
5. **Stress test:** run it. Every line should say Refused.
6. **Panic guard:** set it to 5%, check that the card shows the tracked high, and that Pause/Resume and the cool-off message behave.
7. **Auto-sell:** hold a little of a stock, save a take-profit just under the price, set up a new permission (it must mention the sale), and confirm one automatic sale.
8. **Several rules + trailing stop:** add a second rule with a trailing stop, check both run, and pause one alone.
9. **Gas:** check the Gas card shows the session balance, and that top-up works.
10. **Suggestions:** press Suggest, add one, and confirm it lands paused inside your Limits.
11. **Steward agent:** pick 2 stocks, Balanced, every 15 min, turn it on, then set up Automatic mode (the summary should list sales for the agent's stocks). Within a few checks the log should show decisions with reasons; confirm any buy or sell lands in Activity. Switch to Ask me first and confirm the next buy call arrives as a Ready to buy idea instead of a trade. Turn it off and confirm nothing new happens.
12. Remove the permission and confirm in the wallet.

## Known limits

- No outside security review. Users are told this on the setup card and in the Terms.
- Deposits raise and withdrawals lower the value Panic guard sees. A withdrawal can trip it, which fails safe.
- One sell rule's stock per permission. Changing the sell rule needs a new permission.
- Sale floors are fixed at signing. A stock that falls more than 10% past the stop won't sell automatically.
- Replay ignores fees, slippage, and moves between saved prices.
- Suggestions come from a small model (llama-3.1-8b). They are ideas, not advice, and always start paused.
- The agent's AI can be wrong; the guardrail limits how much it can trade, not whether a trade is good. Workers AI's free allocation is 10,000 neurons a day; past that, the paid Workers plan bills per use or calls fail until 00:00 UTC (the agent then holds). Each agent check is one AI call per owner.
- After changing the agent's stocks, set up Automatic mode again so the permission can sell them.
