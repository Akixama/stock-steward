import type { AgentPlan } from "../lib/agent-decision.ts";

type Row = {
  owner_ref: string; symbol: string; amount_cents: number;
  submit_on_paper: number; enabled: number; day: string;
  decisions_today: number; last_decision_at: string | null;
  last_receipt_id: string | null; updated_at: string;
};

function toPlan(row: Row): AgentPlan {
  return {
    ownerRef: row.owner_ref, symbol: row.symbol, amountCents: row.amount_cents,
    submitOnPaper: row.submit_on_paper === 1, enabled: row.enabled === 1,
    day: row.day, decisionsToday: row.decisions_today,
    lastDecisionAt: row.last_decision_at, lastReceiptId: row.last_receipt_id,
    updatedAt: row.updated_at,
  };
}

export async function loadAgentPlan(db: D1Database, ownerRef: string): Promise<AgentPlan | null> {
  const row = await db.prepare(`SELECT owner_ref, symbol, amount_cents, submit_on_paper, enabled,
    day, decisions_today, last_decision_at, last_receipt_id, updated_at
    FROM agent_plans WHERE owner_ref = ?`).bind(ownerRef).first<Row>();
  return row ? toPlan(row) : null;
}

export async function saveAgentPlan(db: D1Database, plan: AgentPlan): Promise<void> {
  if (!plan.ownerRef || !/^[A-Z.]{1,8}$/.test(plan.symbol) ||
    !Number.isSafeInteger(plan.amountCents) || plan.amountCents < 100 ||
    !Number.isSafeInteger(plan.decisionsToday) || plan.decisionsToday < 0) {
    throw new Error("Invalid automatic decision plan.");
  }
  await db.prepare(`INSERT INTO agent_plans
    (owner_ref, symbol, amount_cents, submit_on_paper, enabled, day, decisions_today,
     last_decision_at, last_receipt_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_ref) DO UPDATE SET symbol = excluded.symbol,
      amount_cents = excluded.amount_cents, submit_on_paper = excluded.submit_on_paper,
      enabled = excluded.enabled, day = excluded.day,
      decisions_today = excluded.decisions_today, last_decision_at = excluded.last_decision_at,
      last_receipt_id = excluded.last_receipt_id, updated_at = excluded.updated_at`)
    .bind(plan.ownerRef, plan.symbol, plan.amountCents, plan.submitOnPaper ? 1 : 0,
      plan.enabled ? 1 : 0, plan.day, plan.decisionsToday,
      plan.lastDecisionAt, plan.lastReceiptId, plan.updatedAt).run();
}

/** Enabled plans whose last decision is older than cutoffIso; bounded per tick. */
export async function dueAgentPlans(db: D1Database, cutoffIso: string, limit = 3): Promise<AgentPlan[]> {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const rows = await db.prepare(`SELECT owner_ref, symbol, amount_cents, submit_on_paper, enabled,
    day, decisions_today, last_decision_at, last_receipt_id, updated_at
    FROM agent_plans WHERE enabled = 1 AND (last_decision_at IS NULL OR last_decision_at <= ?)
    ORDER BY updated_at ASC LIMIT ?`).bind(cutoffIso, safeLimit).all<Row>();
  return rows.results.map(toPlan);
}
