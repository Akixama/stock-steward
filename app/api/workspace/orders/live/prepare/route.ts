import { env } from "cloudflare:workers";
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address } from "viem";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getOwnership } from "@/db/wallet-ownership";
import { liveBuyPilotAllowed, LIVE_BUY_PILOT_MESSAGE } from "@/lib/live-buy-access";
import { reserveAttempt, type AttemptPlan } from "@/db/execution-attempts";
import { VENUE, inspectRoute } from "@/lib/chain-route";
import { routerCandidate } from "@/lib/router-candidate";
import { rolesOperation } from "@/lib/roles-operation";
import { selectStoredFloor, validateLiveAmount } from "@/lib/live-order";
import { PERMIT2 } from "@/lib/install-flow";
import { EXECUTION_CONTRACTS } from "@/lib/autonomy";
import { PILOT_MAX_DAILY_CENTS } from "@/lib/pilot-policy";
import { assembleActivePolicyFor, rpcCall, spendTodayCents } from "../_shared";

const ercAllowanceAbi = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const permitAllowanceAbi = parseAbi(["function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)"]);

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
    const ownership = await getOwnership(env.DB, user.userId);
    if (!ownership?.verifiedAt || !liveBuyPilotAllowed(ownership.address, env.STEWARD_LIVE_BUY_PILOT_WALLETS)) {
      return Response.json({ error: LIVE_BUY_PILOT_MESSAGE }, { status: 403 });
    }
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

    // Orders carry the prices locked at activation: the onchain conditions pin
    // the install-time bytes, so a fresh quote could be signed and then reverted
    // onchain. Refuse that here, with the fix spelled out, instead.
    if (!live.recordedOutputs?.length) {
      return Response.json({ error: "Your permission was turned on before prices were locked in. Turn it on once more above (one signature), then order." }, { status: 422 });
    }
    const exact = (amountCents / 100).toFixed(2);
    const route = await inspectRoute(live.safe, symbol, exact, 50, live.transport);
    if (!route.best || !route.minimumOutputRaw) {
      return Response.json({ error: `No live pool quote for ${symbol} right now. Try again in a moment.` }, { status: 422 });
    }
    if (BigInt(route.balanceRaw) < BigInt(route.inputRaw)) {
      return Response.json({ error: "Your Steward wallet holds too little USDG for this order. Fund it first." }, { status: 422 });
    }
    // The onchain permission pins one exact input size; anything else would be
    // built, signed and then reverted. Refuse it here with the size spelled out.
    if (BigInt(route.inputRaw) !== BigInt(live.policy.inputRaw)) {
      const size = `$${(Number(BigInt(live.policy.inputRaw) / 10000n) / 100).toFixed(2)}`;
      return Response.json({ error: `Your permission covers one exact order size: ${size}. Type ${(Number(BigInt(live.policy.inputRaw) / 10000n) / 100).toFixed(2)} as the amount.` }, { status: 422 });
    }
    // Swap funding must be in place or the order reverts before it starts: the
    // trade router pulls the exact input through the Permit2 helper, and both
    // approvals are set when the permission is turned on.
    let funded = false;
    try {
      const ercRaw = await rpcCall(VENUE.settlement,
        encodeFunctionData({ abi: ercAllowanceAbi, functionName: "allowance", args: [live.safe as Address, PERMIT2] }),
        "latest", live.transport);
      const permitRaw = await rpcCall(PERMIT2,
        encodeFunctionData({ abi: permitAllowanceAbi, functionName: "allowance",
          args: [live.safe as Address, VENUE.settlement as Address, EXECUTION_CONTRACTS.router as Address] }),
        "latest", live.transport);
      const ercAllow = decodeFunctionResult({ abi: ercAllowanceAbi, functionName: "allowance", data: ercRaw }) as bigint;
      const decoded = decodeFunctionResult({ abi: permitAllowanceAbi, functionName: "allowance", data: permitRaw }) as unknown as readonly [unknown, unknown, unknown];
      funded = ercAllow >= BigInt(route.inputRaw) && BigInt(String(decoded[0])) >= BigInt(route.inputRaw)
        && Number(decoded[1]) * 1000 > Date.now() + 60000;
    } catch { funded = false; }
    if (!funded) {
      return Response.json({ error: "Your swap funding is not set up yet. Turn the permission on once more above, then order." }, { status: 422 });
    }
    let floor: { probe: (typeof route.probes)[number]; floorRaw: string };
    try {
      floor = selectStoredFloor(route, live.recordedOutputs);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Order preparation unavailable." }, { status: 422 });
    }
    // The signed order carries the locked pool and floor verbatim; the fresh
    // quote above stays a liveness gate only and is never encoded.
    const ordered = { ...route, best: floor.probe, minimumOutputRaw: floor.floorRaw };
    const policy = {
      ...live.policy,
      outputs: live.policy.outputs.map((output) => output.token.toLowerCase() === route.token.toLowerCase()
        ? { token: output.token, fee: floor.probe.fee, tickSpacing: floor.probe.tickSpacing, minimumOutputRaw: floor.floorRaw }
        : output),
    };
    const operation = rolesOperation(ordered, live.mandate.version, policy);
    const candidate = routerCandidate(ordered, live.mandate.version);
    // Simulate the complete owner-to-Roles-to-Safe envelope, not just the
    // inner swap. A successful quote cannot prove the installed permission or
    // funding path will execute. Fail closed before reserving or asking to sign.
    try {
      const response = await live.transport("https://rpc.mainnet.chain.robinhood.com/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ from: operation.from, to: operation.to, data: operation.data, value: operation.value }, "latest"] }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json() as { result?: string; error?: unknown };
      if (!response.ok || result.error || result.result !== `0x${"0".repeat(63)}1`) {
        throw new Error("Simulation failed");
      }
    } catch {
      return Response.json({ error: "This exact order did not pass the chain simulation. No order was sent. Check your permission and swap funding before trying again." }, { status: 422 });
    }
    if (Date.parse(route.expiresAt) <= Date.now()) {
      return Response.json({ error: "The quote expired during the safety check. Prepare a fresh order." }, { status: 422 });
    }
    const now = new Date();
    const plan: AttemptPlan = {
      owner: user.userId, address: live.safe, intentDigest: candidate.intentDigest,
      mandateVersion: live.mandate.version, day: now.toISOString().slice(0, 10), amountCents,
      dailyCapCents: Math.min(live.mandate.maxDailyBuyCents, PILOT_MAX_DAILY_CENTS),
      candidate, route: ordered, livePolicy: policy,
    };
    const reserved = await reserveAttempt(env.DB, plan, now);
    if (!reserved) {
      return Response.json({ error: "This order was already prepared or the daily budget is spent. One order at a time." }, { status: 409 });
    }
    return Response.json({
      to: operation.to, data: operation.data, value: operation.value, from: operation.from,
      intentDigest: operation.intentDigest, symbol, amountCents,
      minimumOutputRaw: ordered.minimumOutputRaw, outputToken: route.token,
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
