import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { alpacaConfigured, alpacaEnvironment, alpacaOrderSubmissionEnabled,
  getAlpacaConnection } from "@/lib/alpaca-connection";

export async function GET(request: Request) {
  const intent = new URL(request.url).searchParams.get("intent") === "trading" ? "?intent=trading" : "";
  return Response.redirect(new URL(`/connect${intent}`, request.url), 303);
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/workspace", request.url), 303);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid connection request origin." }, { status: 403 });
  }
  if (!alpacaConfigured()) return Response.redirect(new URL("/workspace?broker=unavailable", request.url), 303);
  const trading = new URL(request.url).searchParams.get("intent") === "trading";
  if (trading) {
    if (!alpacaOrderSubmissionEnabled(alpacaEnvironment())) {
      return Response.redirect(new URL("/workspace?broker=unavailable", request.url), 303);
    }
    const existing = await getAlpacaConnection(env.DB!, user.userId);
    if (!existing || existing.environment !== alpacaEnvironment()) {
      return Response.redirect(new URL("/workspace?broker=unavailable", request.url), 303);
    }
  }
  const redirectUri = env.ALPACA_REDIRECT_URI!;
  if (new URL(redirectUri).origin !== new URL(request.url).origin ||
    new URL(redirectUri).pathname !== "/api/broker/alpaca/callback") {
    return Response.json({ error: "Alpaca callback URL does not match this site." }, { status: 503 });
  }
  const state = `${trading ? "trading" : "read"}_${crypto.randomUUID()}${crypto.randomUUID()}`;
  const authorize = new URL("https://app.alpaca.markets/oauth/authorize");
  authorize.search = new URLSearchParams({ response_type: "code", client_id: env.ALPACA_CLIENT_ID!,
    redirect_uri: redirectUri, state, scope: trading ? "data trading" : "data",
    env: alpacaEnvironment() }).toString();
  const response = Response.redirect(authorize, 303);
  response.headers.append("Set-Cookie", `steward_alpaca_state=${state}; HttpOnly; SameSite=Lax; Path=/api/broker/alpaca/callback; Max-Age=600${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}
