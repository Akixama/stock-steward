// Keep this guide in sync with the mandate UI and lib/decision.ts when either changes.
export const guideRevision = "27 September 2026";

export const guideChapters = [
  { id: "overview", number: "01", title: "The model" },
  { id: "status", number: "02", title: "What is live today" },
  { id: "wallet", number: "02A", title: "Wallet evidence & previews" },
  { id: "autonomy", number: "02B", title: "Autonomy & spending authority" },
  { id: "route", number: "02C", title: "Route and wallet control" },
  { id: "testing", number: "02D", title: "Test the current release" },
  { id: "preparation", number: "02E", title: "Execution preparation" },
  { id: "mandate", number: "03", title: "Your mandate" },
  { id: "evidence", number: "04", title: "Broker evidence" },
  { id: "checks", number: "05", title: "Decision checks" },
  { id: "receipts", number: "06", title: "Decision receipts" },
  { id: "orders", number: "07", title: "Order lifecycle" },
  { id: "roadmap", number: "08", title: "Before real money" },
  { id: "glossary", number: "09", title: "Glossary" },
] as const;

export const capabilityStatus = [
  { name: 'Direct-router simulation', state: 'Available · read only', detail: 'Route inspection attempts an exact one-pool router call at the recorded block, records its fingerprints and any revert, and checks canonicality. It does not verify delegated wallet authority or submit transactions. Integer accounting and durable attempt recovery are internal tested foundations; live accounting and execution adapters remain unwired.' },
  { name: 'Autonomy readiness and budget guards', state: 'Available · execution inactive', detail: 'Manually check documented mainnet infrastructure and save a blocked readiness receipt. Atomic reservation accounting and complete-fee budget checks are implemented and tested but not connected to a live executor. Read-only scheduling requires a verified runner. Live direct-pool quoter evidence and optional ownership messages are available. No session key or automatic spending is enabled.' },
  { name: "Robinhood Chain wallet observations", state: "Available · read only", detail: "Connect a browser wallet or inspect a public address on mainnet 4663. Balances use official contracts and one block. Indicative prices apply official multipliers. Saved observations and comparisons are available, with partial purchase previews using saved mandates. Optional historical ownership verification and read-only monitoring are available. No mobile wallet transport or spending. Alpaca remains separate." },
  { name: "Anytime account and partial checks", state: "Available with a connection", detail: "Manually read balances, positions, open orders and market status outside regular hours. Save partial checks with price-dependent items pending. These cannot authorize orders and are not automatically retried." },
  { name: "Save a versioned mandate", state: "Available locally", detail: "Saved under the signed-in workspace owner in the local D1 database." },
  { name: "Request workspace-data deletion", state: "Available locally", detail: "A signed-in owner can record a deletion request from Account. Review, broker-order checks, and erasure are handled manually; submitting a request does not delete data immediately." },
  { name: "Choose an action preference", state: "Available locally", detail: "Approval is the default. Automatic is saved as an inactive future preference; it does not grant trading authority." },
  { name: "Evaluate a proposed buy", state: "Ready for a broker", detail: "The workspace can check a proposed buy using authenticated Alpaca data after OAuth is configured and an eligible account connects." },
  { name: "Connect a brokerage account", state: "Configured on hosted site", detail: "Alpaca OAuth and encrypted token storage support an initial read-only grant and a separately gated trading grant. The hosted site supports authorization; each user connects their own eligible account. Credentials stay server-side." },
  { name: "Create real decision receipts", state: "Ready for a broker", detail: "A successful read-only check saves a receipt under the signed-in owner. No live account has completed that path yet." },
  { name: "Decline a proposal", state: "Available for receipts", detail: "The account owner can decline a checks-passed proposal once. The choice is stored in the trail and sends no order." },
  { name: "Recheck a proposal", state: "Ready for a broker", detail: "A connected owner can read fresh broker data for the same proposed buy. The new receipt is saved alongside the old one." },
  { name: "Review and approve an order", state: "Code ready · disabled", detail: "The exact dollar buy expires no later than 30 seconds after the quote. A separate trading OAuth grant and deployment switch are needed before the owner can approve and submit." },
  { name: "Submit and reconcile orders", state: "Code ready · unverified", detail: "One broker POST is guarded by owner approval, a unique receipt event, and an account-level gate. Another order needs a new broker observation after the first reaches a terminal outcome. Every limit is rechecked against fresh broker data immediately before an attempt, and that evidence is recorded. A manual refresh checks pending orders in the 50 visible receipts by client order ID without another POST, and closes older approvals that never reached an attempt. No live account has tested this path; background monitoring is absent." },
] as const;
