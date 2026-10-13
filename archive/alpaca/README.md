# Archived Alpaca adapter

This directory contains the retired Alpaca Connect OAuth, account reader, paper order, approval, scheduled agent, UI, tests and setup material that previously lived in the active Stock Steward product.

It is not part of the Robinhood Chain product build. The live product uses Robinhood Chain wallet reads, wallet-enforced permissions, Practice mode and owner-approved onchain orders.

The active `/connect` page and former broker API routes remain as clear unavailable waypoints so old links and clients fail explicitly. No database table, migration or stored row was removed.

The archived database helpers include the former Alpaca observation store. The active product uses `db/chain-observations.ts` for Robinhood Chain wallet observations.

To restore this adapter, an owner would need to review the archived OAuth and order model, restore imports and route handlers, configure fresh secrets, run the archived tests, verify the provider's current terms and permissions, and complete a new security and funded account review. Old credentials or grants must not be assumed valid.

The provider-specific news adapter remains in `lib/live-news.ts` because the separate, disabled autonomous strategy runtime still imports it. It is not configured and cannot make news strategies executable without verified provider access.
