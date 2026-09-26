// Keep this guide in sync with the mandate UI and lib/decision.ts when either changes.
export const guideRevision = "25 September 2026";

export const guideChapters = [
  { id: "overview", number: "01", title: "The model" },
  { id: "status", number: "02", title: "What is live today" },
  { id: "mandate", number: "03", title: "Your mandate" },
  { id: "evidence", number: "04", title: "Broker evidence" },
  { id: "checks", number: "05", title: "Decision checks" },
  { id: "receipts", number: "06", title: "Decision receipts" },
  { id: "orders", number: "07", title: "Order lifecycle" },
  { id: "roadmap", number: "08", title: "Before real money" },
  { id: "glossary", number: "09", title: "Glossary" },
] as const;

export const capabilityStatus = [
  { name: "Save a versioned mandate", state: "Available locally", detail: "Saved under the signed-in workspace owner in the local D1 database." },
  { name: "Request workspace-data deletion", state: "Available locally", detail: "A signed-in owner can record a deletion request from Account. Review, broker-order checks, and erasure are handled manually; submitting a request does not delete data immediately." },
  { name: "Choose an action preference", state: "Available locally", detail: "Approval is the default. Automatic is saved as an inactive future preference; it does not grant trading authority." },
  { name: "Evaluate a proposed buy", state: "Ready for a broker", detail: "The workspace can check a proposed buy using authenticated Alpaca data after OAuth is configured and an eligible account connects." },
  { name: "Connect a brokerage account", state: "Code ready · not configured", detail: "Alpaca OAuth and encrypted token storage support an initial read-only grant and a separately gated trading grant. This checkout has no Connect app credentials or connected account." },
  { name: "Create real decision receipts", state: "Ready for a broker", detail: "A successful read-only check saves a receipt under the signed-in owner. No live account has completed that path yet." },
  { name: "Decline a proposal", state: "Available for receipts", detail: "The account owner can decline a checks-passed proposal once. The choice is stored in the trail and sends no order." },
  { name: "Recheck a proposal", state: "Ready for a broker", detail: "A connected owner can read fresh broker data for the same proposed buy. The new receipt is saved alongside the old one." },
  { name: "Review and approve an order", state: "Code ready · disabled", detail: "The exact dollar buy expires no later than 30 seconds after the quote. A separate trading OAuth grant and deployment switch are needed before the owner can approve and submit." },
  { name: "Submit and reconcile orders", state: "Code ready · unverified", detail: "One broker POST is guarded by owner approval, a unique receipt event, and an account-level gate. Another order needs a new broker observation after the first reaches a terminal outcome. Every limit is rechecked against fresh broker data immediately before an attempt, and that evidence is recorded. A manual refresh checks pending orders in the 50 visible receipts by client order ID without another POST, and closes older approvals that never reached an attempt. No live account has tested this path; background monitoring is absent." },
] as const;
