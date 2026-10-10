import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { assembleActivePolicyFor, locateSafe, spendTodayCents } from "../_shared";
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
    const message = error instanceof Error ? error.message : "";
    console.error(`order_status_locked ${message.slice(0, 80)}`);
    // The wallet whose module is missing, so the page can recover the record on
    // its own. Absent when the wallet itself is unknown; the branches below
    // already explain that case.
    let wallet: { safe: string; mandateVersion: number } | null = null;
    try {
      const located = await locateSafe(env.DB, user.userId);
      wallet = { safe: located.safe as string, mandateVersion: located.mandate.version };
    } catch { /* Wallet unknown: the branches below already explain. */ }
    const claimed = wallet ?? {};
    // A locked card the user can act on beats a dismissible error: limits and
    // wallet proof are fixed in Mandate and the activation section above.
    if (/active Steward permission/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "activation" as const, ...claimed });
    }
    if (/Pilot|Save your limits|inconsistent/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "limits" as const, detail: message, ...claimed });
    }
    if (/Verify your wallet/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "wallet" as const });
    }
    return Response.json({ error: message || "Order status unavailable." }, { status: 502 });
  }
}
