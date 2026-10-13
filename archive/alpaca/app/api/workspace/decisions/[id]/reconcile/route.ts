import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getAlpacaConnection } from "@/lib/alpaca-connection";
import { AlpacaOrderGateway } from "@/lib/alpaca-order";
import { reconcileOrder } from "@/lib/order-flow";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid decision reference." }, { status: 400 });
  try {
    const connection = await getAlpacaConnection(env.DB, user.userId);
    if (!connection) return Response.json({ error: "Connect the same Alpaca account first." }, { status: 409 });
    const result = await reconcileOrder({ ownerRef: user.userId, receiptId: id,
      accountRef: connection.accountRef }, new D1DecisionLedger(env.DB),
    new AlpacaOrderGateway(connection));
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Broker order lookup failed." },
      { status: 409 });
  }
}
