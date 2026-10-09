import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { z } from "zod";

const requestSchema = z.object({
  baseVersion: z.number().int().min(0),
  allowedSymbols: z.array(z.string().regex(/^[A-Z.]{1,8}$/)).max(32),
  maxOrderCents: z.number().int().positive().safe(),
  maxDailyBuyCents: z.number().int().positive().safe(),
  maxPositionBps: z.number().int().min(1).max(10_000),
  executionPreference: z.enum(["approval", "automatic"]),
}).strict().refine((value) => value.maxDailyBuyCents >= value.maxOrderCents);

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to save a mandate." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 10_000) return Response.json({ error: "Mandate is too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid mandate request." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Check your symbols and purchase limits." }, { status: 400 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const ledger = new D1DecisionLedger(env.DB);
    const latest = await ledger.getMandate(user.userId);
    if ((latest?.version ?? 0) !== parsed.data.baseVersion) {
      return Response.json({ error: "Your mandate changed in another session. Reload before saving." }, { status: 409 });
    }
    const mandate = {
      version: parsed.data.baseVersion + 1,
      allowedSymbols: [...new Set(parsed.data.allowedSymbols)],
      maxOrderCents: parsed.data.maxOrderCents,
      maxDailyBuyCents: parsed.data.maxDailyBuyCents,
      maxPositionBps: parsed.data.maxPositionBps,
      executionPreference: parsed.data.executionPreference,
      requireApproval: true as const,
    };
    await ledger.saveMandate(user.userId, mandate);
    return Response.json({ mandate });
  } catch (error) {
    console.error("Mandate save failed", error);
    return Response.json({ error: "Could not save your mandate. Your edits are still here; try again." }, { status: 503 });
  }
}
