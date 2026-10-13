import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAlpacaConnection } from "@/lib/alpaca-connection";
import { readAccountView } from "@/lib/anytime";
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503 });
  try {
    const connection = await getAlpacaConnection(env.DB, user.userId);
    if (!connection) return Response.json({ error: "Connect your brokerage account first." }, { status: 409 });
    return Response.json({ account: await readAccountView(connection) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Account read failed." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
