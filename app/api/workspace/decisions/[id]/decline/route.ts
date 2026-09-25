import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";

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
    const ledger = new D1DecisionLedger(env.DB);
    const receipt = await ledger.appendOrderEvent(user.userId, id, {
      type: "declined", at: new Date().toISOString(), by: "account_owner",
    });
    return Response.json({ receipt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not decline this proposal.";
    return Response.json({ error: message }, { status: 409 });
  }
}
