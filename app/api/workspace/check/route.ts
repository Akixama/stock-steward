import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getAlpacaConnection } from "@/lib/alpaca-connection";
import { AlpacaBrokerReader } from "@/lib/alpaca-reader";
import { checkWithBroker } from "@/lib/broker-boundary";
import { prepareAlpacaApproval } from "@/lib/approval-plan";
import { z } from "zod";

const proposalSchema = z.object({ symbol: z.string().regex(/^[A-Z.]{1,8}$/),
  amountCents: z.number().int().positive().safe() }).strict();

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > 1000) {
    return Response.json({ error: "Proposal is too large." }, { status: 413 });
  }
  const body = await request.json().catch(() => null);
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Enter a stock symbol and dollar amount." }, { status: 400 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const connection = await getAlpacaConnection(env.DB, user.userId);
    if (!connection) return Response.json({ error: "Connect an Alpaca account first." }, { status: 409 });
    const ledger = new D1DecisionLedger(env.DB);
    const receipt = await checkWithBroker(new AlpacaBrokerReader(connection),
      ledger, { ownerRef: user.userId, accountRef: connection.accountRef,
        proposal: parsed.data });
    let approvalPlan = null;
    if (receipt.status === "awaiting_approval") {
      try {
        const mandate = await ledger.getMandate(user.userId);
        if (mandate) approvalPlan = prepareAlpacaApproval(receipt, mandate, connection.accountRef);
      } catch { /* The saved decision remains a proposal even if an order cannot be planned. */ }
    }
    return Response.json({ receipt, approvalPlan });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No decision was made." }, { status: 422 });
  }
}
