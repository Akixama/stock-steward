import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getAlpacaConnection, alpacaOrderSubmissionEnabled } from "@/lib/alpaca-connection";
import { AlpacaOrderGateway } from "@/lib/alpaca-order";
import { AlpacaBrokerReader } from "@/lib/alpaca-reader";
import { approveAndSubmit } from "@/lib/order-flow";
import { z } from "zod";

const acknowledgementSchema = z.object({ receiptId: z.string().uuid(),
  accountRef: z.string().min(1).max(128), symbol: z.string().regex(/^[A-Z.]{1,8}$/),
  notional: z.string().regex(/^\d+\.\d{2}$/) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || Number(request.headers.get("content-length")) > 1000) {
    return Response.json({ error: "Invalid order review request." }, { status: 400 });
  }
  const parsed = acknowledgementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.receiptId !== id) {
    return Response.json({ error: "Order acknowledgement does not match this receipt." }, { status: 400 });
  }
  try {
    const connection = await getAlpacaConnection(env.DB, user.userId);
    if (!connection || !connection.tradingScope ||
      !alpacaOrderSubmissionEnabled(connection.environment)) {
      return Response.json({ error: "Order submission is not enabled for this broker connection." }, { status: 409 });
    }
    const receipt = await approveAndSubmit({ ownerRef: user.userId, receiptId: id,
      accountRef: connection.accountRef, acknowledgement: parsed.data,
      tradingEnabled: true }, new D1DecisionLedger(env.DB), new AlpacaOrderGateway(connection),
    new AlpacaBrokerReader(connection));
    return Response.json({ receipt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Order review failed." },
      { status: 409 });
  }
}
