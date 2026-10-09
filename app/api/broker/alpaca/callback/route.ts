import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { oauthRedirect } from "@/lib/oauth-redirect";
import { alpacaConfigured, alpacaEnvironment, alpacaOrderSubmissionEnabled,
  getAlpacaConnection, saveAlpacaConnection } from "@/lib/alpaca-connection";
import { alpacaBase } from "@/lib/alpaca-http";

type TokenResponse = { access_token?: string; token_type?: string; scope?: string };
type AccountResponse = { id?: string };
const clearState = "steward_alpaca_state=; HttpOnly; SameSite=Lax; Path=/api/broker/alpaca/callback; Max-Age=0";

export async function GET(request: Request) {
  const response = (status: string) => {
    const destination = new URL(status === "connected" || status === "trading_connected" ? "/workspace" : "/connect", request.url);
    destination.searchParams.set("broker", status);
    return oauthRedirect(destination, clearState);
  };
  const user = await getChatGPTUser();
  if (!user || !alpacaConfigured()) return response("unavailable");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)steward_alpaca_state=([^;]+)/)?.[1];
  if (!state || !cookie || state !== cookie) return response("invalid_state");
  const trading = state.startsWith("trading_");
  if (!trading && !state.startsWith("read_")) return response("invalid_state");
  if (trading && !alpacaOrderSubmissionEnabled(alpacaEnvironment())) return response("unavailable");
  if (url.searchParams.has("error")) return response("denied");
  const code = url.searchParams.get("code");
  if (!code) return response("denied");
  try {
    const tokenResponse = await fetch("https://api.alpaca.markets/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code,
        client_id: env.ALPACA_CLIENT_ID!, client_secret: env.ALPACA_CLIENT_SECRET!,
        redirect_uri: env.ALPACA_REDIRECT_URI! }), cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange failed (${tokenResponse.status}).`);
    const grant = await tokenResponse.json() as TokenResponse;
    if (!grant.access_token || grant.token_type?.toLowerCase() !== "bearer") throw new Error("Invalid token grant.");
    const scopes = new Set((grant.scope ?? "").split(/\s+/));
    if (!scopes.has("data") || scopes.has("account:write") ||
      (trading ? !scopes.has("trading") : scopes.has("trading"))) {
      throw new Error("Alpaca returned a different permission scope than requested.");
    }
    const environment = alpacaEnvironment();
    const accountResponse = await fetch(`${alpacaBase(environment)}/v2/account`, {
      headers: { Authorization: `Bearer ${grant.access_token}`, Accept: "application/json" }, cache: "no-store",
    });
    if (!accountResponse.ok) throw new Error(`Account verification failed (${accountResponse.status}).`);
    const account = await accountResponse.json() as AccountResponse;
    if (!account.id) throw new Error("Alpaca returned no account ID.");
    if (trading) {
      const existing = await getAlpacaConnection(env.DB!, user.userId);
      if (!existing || existing.accountRef !== account.id || existing.environment !== environment) {
        throw new Error("Trading grant account does not match the existing read-only connection.");
      }
    }
    await saveAlpacaConnection(env.DB!, user.userId, account.id, environment,
      grant.access_token, trading);
    return response(trading ? "trading_connected" : "connected");
  } catch (error) {
    console.error("Alpaca connection failed", error instanceof Error ? error.message : "unknown error");
    return response("failed");
  }
}
