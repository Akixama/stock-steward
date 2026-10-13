# Live news integration � pending provider account

The implementation adapter targets Alpaca News. It uses authenticated requests to a fixed origin, symbol filtering, a bounded 24-hour interval, complete pagination, publication timestamps and stable article IDs. It does not request article content. Missing credentials, stale responses, incomplete pagination or missing access verification leave both news strategies blocked.

Official API reference: https://docs.alpaca.markets/us/reference/news-3

The API documents delayed access for accounts without real-time entitlement. Do not mark real-time access verified merely because a request succeeds. The owner must obtain an account and confirm the application's intended use is covered by the provider agreement. No subscription was purchased and no provider was contacted.

The adapter is implemented and fixture-tested. It is not yet wired to the production strategy scheduler. Deployment secrets and entitlement controls remain unset. Never place API keys in a public environment variable, browser storage, source control or chat.

The owner does not yet have a provider. Before production use, configure credentials through the deployment secret store and verify actual responses with that account. Persist consumed article IDs alongside the execution intent before submission so an ambiguous transaction cannot cause the headline to be traded again.
