import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { assembleActivePolicyFor, spendTodayCents } from "../_shared";
import { planSummary } from "@/lib/permission-plan";
import { PILOT_MAX_DAILY_CENTS, PILOT_MAX_ORDER_CENTS } from "@/lib/pilot-policy";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Read-only: permission state plus today's recorded spend. Nothing is signed or sent.
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const live = await assembleActivePolicyFor(env.DB, user.userId);
    const spent = await spendTodayCents(env.DB, user.userId, live.safe);
    const dailyCap = Math.min(live.mandate.maxDailyBuyCents, PILOT_MAX_DAILY_CENTS);
    return Response.json({
      permissionActive: true,
      safe: live.safe,
      symbols: live.plan.outputs.map((output) => output.symbol),
      perTrade: dollars(Math.min(live.mandate.maxOrderCents, PILOT_MAX_ORDER_CENTS)),
      daily: dollars(dailyCap),
      total: planSummary(live.plan).total,
      spentTodayCents: spent,
      remainingTodayCents: Math.max(0, dailyCap - spent),
    });
  } catch (error) {
    if (error instanceof Error && /active Steward permission/.test(error.message)) {
      return Response.json({ permissionActive: false as const });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Order status unavailable." }, { status: 502 });
  }
}
