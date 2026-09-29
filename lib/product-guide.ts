// Keep this guide in sync with the mandate UI and lib/decision.ts when either changes.
export const guideRevision = "29 September 2026";

export const guideChapters = [
  { id: "overview", number: "01", title: "The model" },
  { id: "status", number: "02", title: "What is live today" },
  { id: "wallet", number: "02A", title: "Wallet evidence & previews" },
  { id: "autonomy", number: "02B", title: "Autonomy & spending authority" },
  { id: "route", number: "02C", title: "Route and wallet control" },
  { id: "testing", number: "02D", title: "Test the current release" },
  { id: "preparation", number: "02E", title: "Execution preparation" },
  { id: "execution-evidence", number: "02F", title: "Wallet evidence & recovery" },
  { id: "strategies", number: "02G", title: "Strategies and practice" },
  { id: "mandate", number: "03", title: "Your mandate" },
  { id: "evidence", number: "04", title: "Wallet evidence" },
  { id: "checks", number: "05", title: "Decision checks" },
  { id: "receipts", number: "06", title: "Decision receipts" },
  { id: "orders", number: "07", title: "Execution lifecycle" },
  { id: "roadmap", number: "08", title: "Before real money" },
  { id: "glossary", number: "09", title: "Glossary" },
] as const;

export const capabilityStatus = [
  {name:'Reviewed strategies and practice',state:'Available · saved simulation',detail:'Four buy-only strategy templates, structured review, approval or automatic practice, separate permission, pause/revoke, fixture prices, simulated clock and downloadable receipts. Configured free server-side AI suggests drafts that require review. Fake balances and receipts are saved per signed-in owner, with optional background checks and safeguard scenarios. Live execution remains inactive.'},
  { name: 'Wallet code and settlement ledger', state: 'Available · read only', detail: 'Inspect canonical wallet code and any delegation indicator. Route receipts combine observed USDG balance with owner-bound pending reservations. External spending, complete USD prices and full portfolio valuation remain unverified. Scheduled recovery verifies recorded direct-router or narrow Roles/Safe outcomes but never sends transactions.' },
  { name: 'Direct-router simulation', state: 'Available · read only', detail: 'Route inspection attempts an exact one-pool router call at the recorded block, records its fingerprints and any revert, and checks canonicality. It does not verify delegated wallet authority or submit transactions. Integer accounting and durable attempt recovery are internal tested foundations; live accounting and execution adapters remain unwired.' },
  { name: 'Autonomy readiness and budget guards', state: 'Available · execution inactive', detail: 'Manually check documented mainnet infrastructure and save a blocked readiness receipt. Atomic reservation accounting and complete-fee budget checks are implemented and tested but not connected to a live executor. Read-only scheduling requires a verified runner. Live direct-pool quoter evidence and optional ownership messages are available. No session key or automatic spending is enabled.' },
  { name: "Robinhood Chain wallet observations", state: "Available · read only", detail: "Connect a browser wallet or inspect a public address on mainnet 4663. Balances use official contracts and one block. Indicative prices apply official multipliers. Saved observations and comparisons are available, with partial purchase previews using saved mandates. Optional historical ownership verification and read-only monitoring are available. No mobile wallet transport or spending." },
  { name: "Save a versioned mandate", state: "Available", detail: "Saved under the signed-in workspace owner in the workspace database." },
  { name: "Request workspace-data deletion", state: "Available locally", detail: "A signed-in owner can record a deletion request from Account. Review and erasure are handled manually; submitting a request does not delete data immediately." },
  { name: "Choose an action preference", state: "Available locally", detail: "Approval is the default. Automatic is saved as an inactive future preference; it does not grant trading authority." },
  { name: "Decline a proposal", state: "Available for receipts", detail: "The account owner can decline a checks-passed proposal once. The choice is stored in the trail and sends no order." },
] as const;


