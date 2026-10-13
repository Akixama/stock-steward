import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { loadAgentPlan, saveAgentPlan, dueAgentPlans } from "./agent-plans.ts";
import type { AgentPlan } from "../lib/agent-decision.ts";

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE agent_plans(owner_ref TEXT PRIMARY KEY, symbol TEXT NOT NULL, amount_cents INTEGER NOT NULL, submit_on_paper INTEGER NOT NULL, enabled INTEGER NOT NULL, day TEXT NOT NULL, decisions_today INTEGER NOT NULL, last_decision_at TEXT, last_receipt_id TEXT, updated_at TEXT NOT NULL);");
  const db = {
    prepare(q: string) {
      let args: (string | number | null)[] = [];
      const stmt = {
        bind(...values: typeof args) { args = values; return stmt; },
        async first() { return sql.prepare(q).get(...args) ?? null; },
        async all() { return { results: sql.prepare(q).all(...args) }; },
        async run() { return { meta: { changes: Number(sql.prepare(q).run(...args).changes) } }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { sql, db };
}

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    ownerRef: "owner-1", symbol: "AAPL", amountCents: 100, submitOnPaper: false,
    enabled: true, day: "2026-10-09", decisionsToday: 1,
    lastDecisionAt: "2026-10-09T12:00:00.000Z", lastReceiptId: "receipt-1",
    updatedAt: "2026-10-09T12:00:00.000Z", ...overrides,
  };
}

test("agent plan round-trips through save and load", async () => {
  const { db } = database();
  const saved = plan();
  await saveAgentPlan(db, saved);
  const loaded = await loadAgentPlan(db, "owner-1");
  assert.deepEqual(loaded, saved);
});

test("saving again updates the single plan row", async () => {
  const { sql, db } = database();
  await saveAgentPlan(db, plan());
  await saveAgentPlan(db, plan({ symbol: "MSFT", amountCents: 250, enabled: false }));
  const rows = sql.prepare("SELECT COUNT(*) AS n FROM agent_plans").get() as { n: number };
  assert.equal(rows.n, 1);
  const loaded = await loadAgentPlan(db, "owner-1");
  assert.equal(loaded?.symbol, "MSFT");
  assert.equal(loaded?.amountCents, 250);
  assert.equal(loaded?.enabled, false);
});

test("load returns null when no plan exists", async () => {
  const { db } = database();
  assert.equal(await loadAgentPlan(db, "nobody"), null);
});

test("due plans exclude disabled, recent and other owners", async () => {
  const { db } = database();
  await saveAgentPlan(db, plan({ ownerRef: "old", lastDecisionAt: "2026-10-09T10:00:00.000Z" }));
  await saveAgentPlan(db, plan({ ownerRef: "recent", lastDecisionAt: "2026-10-09T12:29:00.000Z" }));
  await saveAgentPlan(db, plan({ ownerRef: "off", enabled: false, lastDecisionAt: "2026-10-09T10:00:00.000Z" }));
  await saveAgentPlan(db, plan({ ownerRef: "never", lastDecisionAt: null }));
  const due = await dueAgentPlans(db, "2026-10-09T12:00:00.000Z", 10);
  assert.deepEqual(due.map((item) => item.ownerRef).sort(), ["never", "old"]);
});

test("due plans are bounded by the limit", async () => {
  const { db } = database();
  for (let index = 0; index < 5; index++) {
    await saveAgentPlan(db, plan({ ownerRef: `owner-${index}`, lastDecisionAt: null }));
  }
  const due = await dueAgentPlans(db, "2026-10-09T12:00:00.000Z", 3);
  assert.equal(due.length, 3);
});

test("invalid plans are refused", async () => {
  const { db } = database();
  await assert.rejects(() => saveAgentPlan(db, plan({ amountCents: 50 })), /Invalid automatic decision plan/);
  await assert.rejects(() => saveAgentPlan(db, plan({ symbol: "bad symbol!" })), /Invalid automatic decision plan/);
});
