import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { parseMandateSaveRequest } from "@/lib/mandate-save-schema";
import { memecoinLimitError } from "@/lib/memecoin-list";

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to save a mandate." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 10_000) return Response.json({ error: "Mandate is too large." }, { status: 413 });
  const parsed = await parseMandateSaveRequest(request);
  if (!parsed) return Response.json({ error: "Invalid mandate request." }, { status: 400 });
  if (!parsed.success) return Response.json({ error: "Check your symbols and purchase limits." }, { status: 400 });
  const memecoinError = memecoinLimitError(parsed.data.allowedSymbols, parsed.data.maxOrderCents);
  if (memecoinError) return Response.json({ error: memecoinError }, { status: 400 });
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
