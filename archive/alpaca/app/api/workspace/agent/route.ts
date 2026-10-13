import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { loadAgentPlan, saveAgentPlan } from "@/db/agent-plans";
import { validateAgentProposal, type AgentPlan } from "@/lib/agent-decision";
import { z } from "zod";

const planSchema = z.object({
  enabled: z.boolean(),
  symbol: z.string().regex(/^[A-Z.]{1,8}$/).optional(),
  amountCents: z.number().int().min(100).max(100_000_000).optional(),
  submitOnPaper: z.boolean().optional(),
}).strict();

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const plan = await loadAgentPlan(env.DB, user.userId);
    return Response.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Automatic decision settings are unavailable." },
      { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > 1000) {
    return Response.json({ error: "Plan is too large." }, { status: 413 });
  }
  const parsed = planSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a stock symbol and dollar amount." }, { status: 400 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const existing = await loadAgentPlan(env.DB, user.userId);
    const nowIso = new Date().toISOString();
    if (!parsed.data.enabled) {
      // Stopping keeps the saved plan visible so it can be re-enabled unchanged.
      const stopped: AgentPlan = existing
        ? { ...existing, enabled: false, updatedAt: nowIso }
        : { ownerRef: user.userId, symbol: "AAPL", amountCents: 100, submitOnPaper: false,
            enabled: false, day: "", decisionsToday: 0, lastDecisionAt: null,
            lastReceiptId: null, updatedAt: nowIso };
      await saveAgentPlan(env.DB, stopped);
      return Response.json({ plan: stopped }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!parsed.data.symbol || !parsed.data.amountCents) {
      return Response.json({ error: "Enter a stock symbol and dollar amount." }, { status: 400 });
    }
    const mandate = await new D1DecisionLedger(env.DB).getMandate(user.userId);
    validateAgentProposal({ symbol: parsed.data.symbol, amountCents: parsed.data.amountCents }, mandate);
    // A changed plan starts a fresh decision clock; counters reset with it.
    const changed = !existing || existing.symbol !== parsed.data.symbol ||
      existing.amountCents !== parsed.data.amountCents;
    const plan: AgentPlan = {
      ownerRef: user.userId, symbol: parsed.data.symbol, amountCents: parsed.data.amountCents,
      // The flag is only a preference; canAutoSubmit still enforces paper + trading + switch.
      submitOnPaper: parsed.data.submitOnPaper === true,
      enabled: true,
      day: changed ? "" : existing.day,
      decisionsToday: changed ? 0 : existing.decisionsToday,
      lastDecisionAt: changed ? null : existing.lastDecisionAt,
      lastReceiptId: changed ? null : existing.lastReceiptId,
      updatedAt: nowIso,
    };
    await saveAgentPlan(env.DB, plan);
    return Response.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Plan was not saved." },
      { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
