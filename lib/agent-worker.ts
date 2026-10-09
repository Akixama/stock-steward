import { D1DecisionLedger } from "../db/ledger.ts";
import { dueAgentPlans, saveAgentPlan } from "../db/agent-plans.ts";
import { runAgentDecision, AGENT_MIN_DECISION_GAP_MS, type AgentDecisionStore, type AgentPlan } from "./agent-decision.ts";
import { alpacaOrderSubmissionEnabled, getAlpacaConnection } from "./alpaca-connection.ts";
import { AlpacaOrderGateway } from "./alpaca-order.ts";
import { AlpacaBrokerReader } from "./alpaca-reader.ts";

// Worker-side wiring for the automatic decision agent. Runs inside the scheduled tick
// under its single-run lease. Broker reads use the default fetch; the tick's chain
// transport is never used for Alpaca calls. The agent submits nothing on live accounts.
export async function tickAgentDecisions(db: D1Database, now = new Date()) {
  const summary = { due: 0, held: 0, decided: 0, submitted: 0, unknown: 0, aborted: 0, skipped: 0, failed: 0 };
  const ledger = new D1DecisionLedger(db);
  const store: AgentDecisionStore = Object.assign(ledger, {
    saveAgentState: (plan: AgentPlan) => saveAgentPlan(db, plan),
  });
  const cutoff = new Date(now.getTime() - AGENT_MIN_DECISION_GAP_MS).toISOString();
  let plans: AgentPlan[] = [];
  try { plans = await dueAgentPlans(db, cutoff, 3); } catch { return summary; }
  for (const plan of plans) {
    summary.due++;
    try {
      const mandate = await ledger.getMandate(plan.ownerRef);
      const connection = await getAlpacaConnection(db, plan.ownerRef);
      if (!mandate || !connection) { summary.skipped++; continue; }
      const result = await runAgentDecision({
        plan, mandate, accountRef: connection.accountRef,
        environment: connection.environment, tradingScope: connection.tradingScope,
        submissionEnabled: alpacaOrderSubmissionEnabled(connection.environment),
        store, reader: new AlpacaBrokerReader(connection), gateway: new AlpacaOrderGateway(connection),
      }, now);
      if (result.status === "skipped") summary.skipped++;
      else if (result.status === "held") { summary.held++; summary.decided++; }
      else if (result.status === "submitted") { summary.submitted++; summary.decided++; }
      else if (result.status === "unknown") { summary.unknown++; summary.decided++; }
      else if (result.status === "aborted") { summary.aborted++; summary.decided++; }
      else summary.decided++;
    } catch { summary.failed++; }
  }
  return summary;
}
