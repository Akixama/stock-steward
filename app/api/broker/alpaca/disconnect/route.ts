import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { removeAlpacaConnection } from "@/lib/alpaca-connection";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Broker storage is unavailable." }, { status: 503 });
  await removeAlpacaConnection(env.DB, user.userId);
  return Response.json({ disconnected: true });
}
