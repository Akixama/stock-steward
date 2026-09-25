import { env } from "cloudflare:workers";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { alpacaConfigured, alpacaOrderSubmissionEnabled,
  getAlpacaConnection } from "@/lib/alpaca-connection";
import type { DecisionReceipt, Mandate } from "@/lib/decision";
import WorkspaceClient from "./workspace-client";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireChatGPTUser("/workspace");
  let mandate: Mandate | null = null;
  let receipts: DecisionReceipt[] = [];
  let storageError: string | null = null;
  let connection: { accountRef: string; environment: "live" | "paper";
    tradingScope: boolean } | null = null;
  try {
    if (!env.DB) throw new Error("D1 binding unavailable");
    const ledger = new D1DecisionLedger(env.DB);
    const [savedMandate, savedReceipts, linkedBroker] = await Promise.all([
      ledger.getMandate(user.userId),
      ledger.listDecisions(user.userId),
      getAlpacaConnection(env.DB, user.userId),
    ]);
    mandate = savedMandate;
    receipts = savedReceipts;
    if (linkedBroker) connection = { accountRef: linkedBroker.accountRef,
      environment: linkedBroker.environment, tradingScope: linkedBroker.tradingScope };
  } catch (error) {
    console.error("Workspace storage unavailable", error);
    storageError = "Your saved workspace is temporarily unavailable. Please try again shortly.";
  }
  return <WorkspaceClient initialMandate={mandate} initialReceipts={receipts}
    connection={connection} alpacaReady={alpacaConfigured()}
    orderSubmissionReady={connection ? alpacaOrderSubmissionEnabled(connection.environment) : false}
    storageError={storageError} />;
}
