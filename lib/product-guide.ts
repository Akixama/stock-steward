// Keep this guide in sync with the mandate UI and lib/decision.ts when either changes.
export const guideRevision = "23 October 2026";

export const guideChapters = [
  { id: "overview", number: "01", title: "The model" },
  { id: "status", number: "02", title: "What is live today" },
  { id: "wallet", number: "02A", title: "Wallet evidence & previews" },
  { id: "route", number: "02C", title: "Route and wallet control" },
  { id: "testing", number: "02D", title: "Test the current release" },
  { id: "preparation", number: "02E", title: "Execution preparation" },
  { id: "execution-evidence", number: "02F", title: "Wallet evidence & recovery" },
  { id: "strategies", number: "02G", title: "Strategies and practice" },
  { id: "mandate", number: "03", title: "Your limits" },
  { id: "evidence", number: "04", title: "Wallet evidence" },
  { id: "checks", number: "05", title: "Decision checks" },
  { id: "receipts", number: "06", title: "Decision receipts" },
  { id: "orders", number: "07", title: "Execution lifecycle" },
  { id: "roadmap", number: "08", title: "Beyond the current pilot" },
  { id: "glossary", number: "09", title: "Glossary" },
] as const;

export const capabilityStatus = [
  {name:'Reviewed strategies and practice',state:'Available · saved simulation',detail:'Twelve Practice strategy types cover scheduled, price, allocation, accumulation, news and portfolio rules for buys and sales. Review, exact approval or continuous Practice checks, separate permission, pause/revoke, indicative quotes and downloadable receipts are available. Server-side AI suggests drafts that require review. Fake balances and receipts are saved per signed-in owner, with optional background checks and safeguard scenarios.'},
  { name: 'Wallet code and settlement ledger', state: 'Available · read only', detail: 'Inspect canonical wallet code and any delegation indicator. Route receipts combine observed USDG balance with owner-bound pending reservations. External spending, complete USD prices and full portfolio valuation remain unverified. Scheduled recovery verifies recorded direct-router or narrow Roles/Safe outcomes but never sends transactions.' },
  { name: 'Direct-router simulation', state: 'Available · read only', detail: 'Route inspection attempts an exact one-pool router call at the recorded block, records its fingerprints and any revert, and checks canonicality. It does not verify delegated wallet authority or submit transactions. Integer accounting and durable attempt recovery are internal tested foundations; live accounting and execution adapters remain unwired.' },
  { name: "Robinhood Chain wallet observations", state: "Available · read only", detail: "Connect a browser wallet or inspect a public address on mainnet 4663. Balances use official contracts and one block. Indicative prices apply official multipliers. Saved observations and comparisons are available, with partial purchase previews using saved mandates. Optional historical ownership verification and read-only monitoring are available. No mobile wallet transport or spending." },
  { name: "In-product bridging to Robinhood Chain", state: "Available · interface only", detail: "The Chain panel embeds a LI.FI bridge prefilled to Robinhood Chain 4663 and USDG, with the observed wallet as destination; Jumper, Relay and the official bridging guide remain as fallbacks. You sign every transfer in your own wallet and a licensed protocol settles; Stock Steward never holds or carries funds." },
  { name: "Spending-permission install review and signing", state: "Available · review first", detail: "Stock Steward compiles your saved limits into the exact onchain policy (per-buy, daily and total caps, allowed stock tokens and expiry) with the complete setup-fee table. The install driver combines setup into one owner-approved transaction and verifies every effect onchain. The server computes calldata only; it can never sign." },
  { name: "Save versioned limits", state: "Available", detail: "Saved under the signed-in workspace owner in the workspace database." },
  { name: "Request workspace-data deletion", state: "Available locally", detail: "A signed-in owner can record a deletion request from Account. Review and erasure are handled manually; submitting a request does not delete data immediately." },
  { name: "Choose an action preference", state: "Available locally", detail: "Approval is the default. Check-only evaluates a proposal without placing an order." },
  { name: "Decline a proposal", state: "Available for receipts", detail: "The account owner can decline a checks-passed proposal once. The choice is stored in the trail and sends no order." },
] as const;


