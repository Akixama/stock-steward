import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { reserveAttempt, type AttemptPlan } from "@/db/execution-attempts";
import { inspectRoute } from "@/lib/chain-route";
import { routerCandidate } from "@/lib/router-candidate";
import { rolesOperation } from "@/lib/roles-operation";
import { validateLiveAmount } from "@/lib/live-order";
import { PILOT_MAX_DAILY_CENTS } from "@/lib/pilot-policy";
import { assembleActivePolicyFor, spendTodayCents } from "../_shared";

// Builds one exact owner-signed order and reserves it. The server never signs:
// the wallet sends the returned transaction, then the receipt route reconciles it.
// Quotes expire in 30 seconds; an expired preparation must never be signed.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const body = await request.json() as { symbol?: unknown; amountCents?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const amountCents = typeof body.amountCents === "number" ? body.amountCents : NaN;

    const live = await assembleActivePolicyFor(env.DB, user.userId);
    if (!live.plan.outputs.some((output) => output.symbol === symbol)) {
      return Response.json({ error: "That stock is not in your approved mandate." }, { status: 422 });
    }
    const spent = await spendTodayCents(env.DB, user.userId, live.safe);
    const amount = validateLiveAmount(amountCents, live.mandate, spent);
    if (!amount.ok) return Response.json({ error: amount.error }, { status: 422 });

    const exact = (amountCents / 100).toFixed(2);
    const route = await inspectRoute(live.safe, symbol, exact, 50, live.transport);
    if (!route.best || !route.minimumOutputRaw) {
      return Response.json({ error: `No live pool quote for ${symbol} right now. Try again in a moment.` }, { status: 422 });
    }
    if (BigInt(route.balanceRaw) < BigInt(route.inputRaw)) {
      return Response.json({ error: "Your Steward wallet holds too little USDG for this order. Fund it first." }, { status: 422 });
    }
    // Pin this order's exact pool price into the policy copy. Quotas and keys do
    // not depend on prices, so the permission match is unaffected.
    const policy = {
      ...live.policy,
      outputs: live.policy.outputs.map((output) => output.token.toLowerCase() === route.token.toLowerCase()
        ? { token: output.token, fee: route.best!.fee, tickSpacing: route.best!.tickSpacing, minimumOutputRaw: route.minimumOutputRaw! }
        : output),
    };
    const operation = rolesOperation(route, live.mandate.version, policy);
    const candidate = routerCandidate(route, live.mandate.version);
    const now = new Date();
    const plan: AttemptPlan = {
      owner: user.userId, address: live.safe, intentDigest: candidate.intentDigest,
      mandateVersion: live.mandate.version, day: now.toISOString().slice(0, 10), amountCents,
      dailyCapCents: Math.min(live.mandate.maxDailyBuyCents, PILOT_MAX_DAILY_CENTS),
      candidate, route, livePolicy: policy,
    };
    const reserved = await reserveAttempt(env.DB, plan, now);
    if (!reserved) {
      return Response.json({ error: "This order was already prepared or the daily budget is spent. One order at a time." }, { status: 409 });
    }
    return Response.json({
      to: operation.to, data: operation.data, value: operation.value, from: operation.from,
      intentDigest: operation.intentDigest, symbol, amountCents,
      minimumOutputRaw: route.minimumOutputRaw, outputToken: route.token,
      expiresAt: route.expiresAt,
      notice: "Review every figure, then sign in your wallet. The quote expires in seconds; never sign an expired order.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/RPC transport unavailable|RPC call unavailable|Registry transport unavailable|Registry unavailable/.test(message)) {
      return Response.json({ error: "The chain connection hiccuped. Press Prepare exact order again." }, { status: 502 });
    }
    return Response.json({ error: message || "Order preparation unavailable." }, { status: 502 });
  }
}
