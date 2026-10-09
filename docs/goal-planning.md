# Goal planning

My plan stores one contribution plan per signed-in workspace. Users review a goal name, target, recorded savings, monthly contribution, timeframe and comfort with price changes before saving. Progress reflects only manually recorded savings; fake practice portfolios remain separate.

The calculation assumes no investment growth, losses, fees, taxes or inflation. It shows the contribution-only total and, when there is a gap, the monthly amount needed to cover it. Completed and expired goals have explicit states. Editing a plan retains its original start date; the timeframe is a total number of months from that date.

Goal saves do not modify mandates, confirmed strategies, practice permissions or live spending authority. Owner-scoped storage and optimistic revisions prevent overwriting a newer save from another tab. Errors retain the draft; reloading the saved plan is an explicit user action.

The comfort preference shapes the planning guidance shown with the saved plan: cautious savers see steady-pace and buffer suggestions, balanced savers see dollar-cost style suggestions, and comfort with larger swings sees rebalancing and price-band suggestions, always pointing at Practice rules. The guidance is general planning guidance; it does not select investments or alter trading rules.
