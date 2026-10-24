import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { locateSafe } from "../orders/live/_shared";
import { checkPositionLimit } from "@/lib/position-limit-check";

const headers = { "Cache-Control": "no-store" };

// Read-only preview of the "max in one stock" check for the Buy checker. The same check
// runs again on the server before any buy is prepared.
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503, headers });
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const amountCents = Number(params.get("amountCents"));
  if (!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol) || !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000) {
    return Response.json({ error: "Choose a stock and amount." }, { status: 400, headers });
  }
  try {
    const located = await locateSafe(env.DB, user.userId);
    const result = await checkPositionLimit(env.DB, user.userId, located.safe, symbol, amountCents, located.mandate.maxPositionBps);
    return Response.json({ ...result, maxPositionBps: located.mandate.maxPositionBps }, { headers });
  } catch {
    return Response.json({ ok: false, reason: "unavailable", error: "Connect and verify your wallet to check this." }, { headers });
  }
}
