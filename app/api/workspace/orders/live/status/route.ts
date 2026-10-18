import { env } from "cloudflare:workers";
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseAbi, type Address } from "viem";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getOwnership } from "@/db/wallet-ownership";
import { liveBuyPilotAllowed, LIVE_BUY_PILOT_MESSAGE } from "@/lib/live-buy-access";
import { assembleActivePolicyFor, locateSafe, rpcCall, spendTodayCents } from "../_shared";
import { VENUE } from "@/lib/chain-route";
import { planSummary } from "@/lib/permission-plan";
import { PILOT_MAX_DAILY_CENTS, PILOT_MAX_ORDER_CENTS } from "@/lib/pilot-policy";
import { listSpendEvidence } from "@/db/execution-attempts";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Read-only: permission state plus today's recorded spend. Nothing is signed or sent.
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const ownership = await getOwnership(env.DB, user.userId);
    if (!ownership?.verifiedAt || !liveBuyPilotAllowed(ownership.address, env.STEWARD_LIVE_BUY_PILOT_WALLETS)) {
      return Response.json({ permissionActive: false as const, blocked: "pilot" as const, detail: LIVE_BUY_PILOT_MESSAGE });
    }
    const live = await assembleActivePolicyFor(env.DB, user.userId);
    // A recorded permission without locked prices can never execute: its
    // onchain conditions pin install-time bytes no fresh quote can satisfy.
    // Say so plainly instead of letting the first order fail in the wallet.
    if (!live.recordedOutputs?.length) {
      throw new Error("No active Steward permission with locked prices. Turn it on once more above (one signature), then order.");
    }
    const spent = await spendTodayCents(env.DB, user.userId, live.safe);
    const spending = await listSpendEvidence(env.DB, user.userId, live.safe);
    const dailyCap = Math.min(live.mandate.maxDailyBuyCents, PILOT_MAX_DAILY_CENTS);
    // One read-only balance check so the page can say whether the wallet is
    // funded yet. A failed read leaves the card neutral instead of blocking.
    let balanceCents: number | null = null;
    try {
      const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
      const raw = await rpcCall(VENUE.settlement,
        encodeFunctionData({ abi: balanceAbi, functionName: "balanceOf", args: [live.safe as Address] }),
        "latest", live.transport);
      balanceCents = Number(BigInt(decodeFunctionResult({ abi: balanceAbi, functionName: "balanceOf", data: raw }) as bigint) / 10000n);
    } catch { /* Balance unknown. */ }
    const holdings = await Promise.all(live.plan.outputs.map(async (output) => {
      try {
        const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
        const [raw, decimalsRaw] = await Promise.all([
          rpcCall(output.token, encodeFunctionData({ abi, functionName: 'balanceOf', args: [live.safe as Address] }), 'latest', live.transport),
          rpcCall(output.token, encodeFunctionData({ abi, functionName: 'decimals' }), 'latest', live.transport),
        ]);
        const balance = decodeFunctionResult({ abi, functionName: 'balanceOf', data: raw }) as bigint;
        const decimals = Number(decodeFunctionResult({ abi, functionName: 'decimals', data: decimalsRaw }));
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported decimals');
        return { symbol: output.symbol, tokens: formatUnits(balance, decimals) };
      } catch { return { symbol: output.symbol, tokens: null }; }
    }));
    const latestOrder = await env.DB.prepare("SELECT transaction_hash AS hash, intent_digest AS intentDigest, state FROM execution_attempts WHERE owner_ref=? AND address=? AND transaction_hash IS NOT NULL AND state IN ('submitted','unknown','attempting','confirmed','reverted') ORDER BY updated_at DESC LIMIT 1").bind(user.userId, live.safe.toLowerCase()).first<{ hash: string; intentDigest: string; state: string }>();
    return Response.json({
      latestOrder,
      holdings,
      filledTodayCents: spending?.filledCents ?? null,
      pendingCents: spending?.pendingCents ?? null,
      permissionActive: true,
      safe: live.safe,
      symbols: live.plan.outputs.map((output) => output.symbol),
      perTrade: dollars(Math.min(live.mandate.maxOrderCents, PILOT_MAX_ORDER_CENTS)),
      perTradeCents: Math.min(live.mandate.maxOrderCents, PILOT_MAX_ORDER_CENTS),
      balanceCents,
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
    // A permission without locked prices names its own fix; anything else keeps
    // the generic activation guidance.
    if (/locked prices/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "activation" as const, detail: message, ...claimed });
    }
    if (/active Steward permission/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "activation" as const, ...claimed });
    }
    if (/Pilot|Save your limits|inconsistent|permission window ended/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "limits" as const, detail: message, ...claimed });
    }
    if (/Verify your wallet/.test(message)) {
      return Response.json({ permissionActive: false as const, blocked: "wallet" as const });
    }
    return Response.json({ error: message || "Order status unavailable." }, { status: 502 });
  }
}
