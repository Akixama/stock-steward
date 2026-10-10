import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAttempt, settleAttempt, type AttemptPlan } from "@/db/execution-attempts";
import { reconcileOwnerOrderFill } from "@/lib/chain-fill-proof";
import { rolesOperation } from "@/lib/roles-operation";
import { verifyPolicyReadback, type ReadbackCall } from "@/lib/live-order";
import { compileRolesPolicy, type RolesPolicy } from "@/lib/roles-permission";
import type { Hex } from "viem";
import { rpcCall } from "../_shared";

// Verifies the exact onchain evidence for a submitted order and settles its receipt:
// a verified fill, a reverted transaction, or unknown (check again later). Proof
// fields are rebuilt server-side from the stored preparation; the browser's word
// for what happened is never accepted.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const body = await request.json() as { intentDigest?: unknown };
    const intentDigest = typeof body.intentDigest === "string" ? body.intentDigest : "";
    if (!/^0x[0-9a-f]{64}$/.test(intentDigest)) {
      return Response.json({ error: "Invalid order identity." }, { status: 400 });
    }
    const attempt = await getAttempt(env.DB, user.userId, intentDigest);
    if (!attempt?.transaction_hash) {
      return Response.json({ error: "No submitted transaction for this order yet." }, { status: 409 });
    }
    const plan = JSON.parse(attempt.plan_json) as AttemptPlan;
    if (!plan.route || !plan.livePolicy || plan.intentDigest !== intentDigest) {
      return Response.json({ error: "Stored preparation is incomplete; the order stays unsettled." }, { status: 502 });
    }
    const policy = plan.livePolicy as RolesPolicy;
    const compiled = compileRolesPolicy(policy);
    const operation = rolesOperation(plan.route, attempt.mandate_version, policy);
    const transport = fetch;
    const verify = async (block: Hex) => {
      const call: ReadbackCall = (to, data, blockTag) => rpcCall(to, data, blockTag || block, transport);
      const readback = await verifyPolicyReadback(policy, compiled, call, block);
      return readback.allOk;
    };
    const proof = await reconcileOwnerOrderFill(
      plan.route, attempt.mandate_version, attempt.transaction_hash, policy.routerCodeHash,
      { from: operation.from, to: operation.to, data: operation.data, value: operation.value, verify },
      transport,
    );
    await settleAttempt(env.DB, user.userId, intentDigest, {
      hash: proof.hash, canonicalFinalized: proof.canonicalFinalized,
      outcome: proof.outcome, intentDigest: proof.intentDigest,
    }, new Date());
    return Response.json({
      outcome: proof.outcome,
      hash: proof.hash,
      paidUsdg: proof.actualInputRaw === null ? null : `$${(Number(BigInt(proof.actualInputRaw)) / 1_000_000).toFixed(2)}`,
      receivedNote: proof.actualOutputRaw === null ? null : "Stock tokens arrived in your Steward wallet. Exact amounts are in the evidence.",
      why: proof.outcome === "verified_fill"
        ? "Exact calldata and bounded token transfers verified in a finalized block."
        : proof.outcome === "reverted"
          ? "The transaction reverted onchain. No stock arrived; network fees may still have been spent. Your daily budget is released."
          : "Not yet provable. Wait a little and track again; nothing is assumed either way.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Reconciliation unavailable." }, { status: 502 });
  }
}
