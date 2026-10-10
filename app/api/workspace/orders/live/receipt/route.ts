import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { beginAttempt, getAttempt, recordSubmission } from "@/db/execution-attempts";

// Records the wallet's transaction hash for a prepared order. The hash alone proves
// nothing: the reconcile route verifies the exact onchain evidence before any receipt.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const body = await request.json() as { intentDigest?: unknown; hash?: unknown };
    const intentDigest = typeof body.intentDigest === "string" ? body.intentDigest : "";
    const hash = typeof body.hash === "string" ? body.hash.toLowerCase() : "";
    if (!/^0x[0-9a-f]{64}$/.test(intentDigest) || !/^0x[0-9a-f]{64}$/.test(hash)) {
      return Response.json({ error: "Invalid order identity." }, { status: 400 });
    }
    const attempt = await getAttempt(env.DB, user.userId, intentDigest);
    if (!attempt || attempt.state !== "reserved") {
      return Response.json({ error: "No prepared order matches. Prepare it again." }, { status: 409 });
    }
    const now = new Date();
    if (!await beginAttempt(env.DB, user.userId, intentDigest, attempt.mandate_version, now)) {
      return Response.json({ error: "This order already moved past preparation." }, { status: 409 });
    }
    if (!await recordSubmission(env.DB, user.userId, intentDigest, hash, now)) {
      return Response.json({ error: "This order already carries a transaction." }, { status: 409 });
    }
    return Response.json({ state: "submitted" as const, intentDigest, hash, notice: "Recorded. Track the receipt to verify what actually happened onchain." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Receipt unavailable." }, { status: 502 });
  }
}
