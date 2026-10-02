# Strategies and fake-money Practice

Stock Steward's non-real-money workflow is: save a Mandate, confirm a Strategy, authorize Practice, then start the agent or run one check. The AI interprets natural language into a draft only. The reviewed structured rules, saved Mandate and a separate 24-hour Practice permission govern every simulated trade. No wallet grant, broker order or blockchain transaction is sent.

## Strategy coverage

- Scheduled buying and price-ceiling buying.
- Target-allocation buying and cautious accumulation limited by elapsed time and price movement.
- Selling held shares above a price or below a loss-limit price.
- Buying below one price and selling held shares above another price in one rule.
- Rebalancing one stock against fake cash.
- Rebalancing two or three approved stocks toward explicit percentage targets. Targets may total less than 100%; the remainder stays in fake cash. One stock is traded per check, with overweight positions considered first.

Every trade is capped by the Mandate's single-trade limit. Buys also obey the daily buy budget, minimum cash reserve and position concentration cap. Sales require sufficient precise simulated shares. Portfolio targets must be in the Mandate, each at or below its concentration cap, and include every stock already held in Practice. Shorting, leverage, arbitrary news triggers and an open-ended stock universe are unsupported.

## Price sources and persistence

Practice starts with $1,000 fake cash. Test prices let the user change a stock price, advance the clock, and exercise stale-quote, low-cash, daily-budget and concentration scenarios. Switching to read-only live stock prices resets the fake session after permission is revoked. Live prices are indicative Robinhood underlying-equity quotes for supported Robinhood Chain stock tokens. Simulated buys use the ask and sales or holdings valuation use the bid. A missing, halted or quote older than 60 seconds blocks action; all portfolio targets and held stocks need current quotes. No actual market fill, trading fee or slippage is reproduced. Fixture prices remain available for fast deterministic tests.

Rules, balances, permission and the last 100 non-hold decisions plus 40 recent holds are saved per signed-in owner. Revision checks prevent two tabs or background wakes from applying the same trade twice. Exact approvals expire after 60 seconds and are rechecked against unchanged rules and evidence. The agent checks every eight seconds while the workspace is open. GitHub requests optional authenticated background wakes every 15 minutes, but actual runs can be delayed by hours; approval mode still waits for the owner. Pause and revoke stop future checks. Revoke before resetting fake funds. Export receipts from Trail before reset.

The Practice portfolio view shows cash, positions, current allocation, target allocation and change in total fake value since the last $1,000 reset. Its total is a mark-to-market estimate, not realized profit or a market fill. Each Trail receipt records the rule version, mandate version, observed evidence and passes or failures. Receipts distinguish simulated purchases, sales, approvals, holds and declines without suggesting a real transaction occurred.

## AI and release boundary

The configured server-side Cloudflare Workers AI proposes a structured draft. It can ask for missing numbers or reject unsupported directions. Users need no model download. The service enforces 50 attempts site-wide and 10 per user per UTC day with a 15-second cooldown. Applying a draft does not confirm it, authorize Practice or make a trade. The user can set the fields directly when AI is unavailable.

The Live selector remains inactive. Practice permission cannot authorize real funds. Actual custody, permissions, live economic valuation, settlement, fees, compliance and guarded order execution require separate implementation and verification.

## Owner test path

1. Save a Mandate with AAPL and META, a $1 per-trade limit, a $5 daily buy budget, and at least 20% maximum position per stock.
2. In Strategy, choose Balance a portfolio: AAPL 10%, META 15%, two percentage points of drift, at most $1 per trade, one hour between trades, $20 cash reserve. Review and confirm.
3. In Practice, use Test prices for a fast run. Authorize and start the agent; the first eligible check should buy the more underweight stock, META. Trail should show one simulated purchase and cash should fall by $1.
4. Use Test controls → Position too large to seed a precise overweight AAPL holding, then run one check. An eligible sale should raise fake cash and lower shares. In approval mode, cash must not change until the exact sale is approved.
5. Try a stale quote or daily-limit scenario. The agent should hold and record why. Pause, revoke, reload, and confirm balances and receipts persist. Download receipts before resetting.
6. For an unattended test, switch to live prices only after revoking permission and accepting the reset. Confirm the strategy again if needed, authorize, start the agent, enable background Practice if available, and inspect the dated receipts later. Unavailable or stale quotes must produce holds, not fixture-based trades.
