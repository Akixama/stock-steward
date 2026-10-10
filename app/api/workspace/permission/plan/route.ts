import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getOwnership } from "@/db/wallet-ownership";
import { CHAIN, registry } from "@/lib/robinhood-chain";
import { chainTransport } from "@/lib/chain-transport";
import { planFromMandate, planSummary } from "@/lib/permission-plan";
import { reviewSetupFees, type SetupFeeEvidence } from "@/lib/setup-fees";
import { validatePilotMandate } from "@/lib/pilot-policy";

// Compiles the owner's saved mandate into the exact onchain spending policy activation
// would create, with the complete setup-fee review in dollars. Read-only: nothing is signed,
// deployed or submitted from this route.

// Component gas from the isolated contract lab; labelled fixture evidence, never a live quote.
const FIXTURE_GAS = {
  wallet_creation: "650000", module_creation: "950000", permission_installation: "320000",
  token_approvals: "150000", execution: "280000", revocation: "160000",
} as const;

async function ethPriceUsd(): Promise<number | null> {
  const sources: (() => Promise<number | null>)[] = [
    async () => {
      const price = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const data = await price.json() as { ethereum?: { usd?: number } };
      return typeof data.ethereum?.usd === "number" && data.ethereum.usd > 0 ? data.ethereum.usd : null;
    },
    async () => {
      const price = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot",
        { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const data = await price.json() as { data?: { amount?: string } };
      const usd = Number(data.data?.amount);
      return Number.isFinite(usd) && usd > 0 ? usd : null;
    },
    async () => {
      const price = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD",
        { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const data = await price.json() as { result?: Record<string, { c?: [string] }> };
      const first = Object.values(data.result ?? {})[0];
      const usd = Number(first?.c?.[0]);
      return Number.isFinite(usd) && usd > 0 ? usd : null;
    },
  ];
  for (const source of sources) {
    try {
      const usd = await source();
      if (usd !== null) return usd;
    } catch { /* Try the next price source. */ }
  }
  return null;
}

async function feeEvidence(now: number): Promise<SetupFeeEvidence> {
  let maxFeePerGasWei = "0";
  let ethUpperMicroUsd = "0";
  let priceVerified = false;
  const gasPayload = { jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] };
  try {
    const rpc = await fetch(CHAIN.rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(gasPayload),
      cache: "no-store",
    });
    const gasResult = await rpc.json() as { result?: string };
    if (gasResult.result) maxFeePerGasWei = BigInt(gasResult.result).toString();
  } catch { /* Fall through to the backup transport. */ }
  if (maxFeePerGasWei === "0") {
    try {
      const transport = chainTransport(env.ALCHEMY_API_KEY);
      const rpc = await transport(CHAIN.rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(gasPayload),
        cache: "no-store",
      });
      const gasResult = await rpc.json() as { result?: string };
      if (gasResult.result) maxFeePerGasWei = BigInt(gasResult.result).toString();
    } catch { /* An unreadable gas price leaves the review pending, never assumed. */ }
  }
  const usd = await ethPriceUsd();
  if (usd !== null) {
    ethUpperMicroUsd = String(Math.ceil(usd * 1_000_000));
    priceVerified = true;
  }
  return {
    observedAt: now, chainId: 4663, source: "isolated-fixture",
    maxFeePerGasWei, ethUpperMicroUsd, priceVerified,
    components: Object.entries(FIXTURE_GAS).map(([name, gas]) => ({
      name: name as keyof typeof FIXTURE_GAS, gas, dataFeeWei: "0", providerFeeWei: "0",
    })),
  };
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const mandate = await new D1DecisionLedger(env.DB).getMandate(user.userId);
    const ownership = await getOwnership(env.DB, user.userId);
    if (!ownership?.verifiedAt) return Response.json({ error: "Verify your wallet ownership first." }, { status: 409 });
    const registryResponse = await fetch("https://api.robinhood.com/rhj/assets", { cache: "no-store" });
    const tokens = registry(await registryResponse.json());
    const outputs = tokens
      .filter((token) => token.status === "Active" || token.status === "active")
      .map((token) => ({ symbol: token.symbol, token: token.contract }));
    const plan = planFromMandate(mandate, ownership.address,
      outputs.length ? outputs : tokens.map((token) => ({ symbol: token.symbol, token: token.contract })));
    if ("error" in plan) return Response.json({ error: plan.error }, { status: 422 });
    // Pilot lock: activation refuses any mandate above $10 a trade, $50 a day
    // ($100 total), or without approval on every order.
    const pilot = validatePilotMandate(mandate);
    if (!pilot.ok) return Response.json({ error: pilot.error }, { status: 422 });
    const now = Date.now();
    const evidence = await feeEvidence(now);
    const review = reviewSetupFees(evidence, mandate!.maxDailyBuyCents, now);
    return Response.json({
      plan, summary: planSummary(plan),
      ownership: { address: ownership.address, verifiedAt: ownership.verifiedAt, method: ownership.method },
      fees: { evidence, review },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activation review unavailable." },
      { status: 502 });
  }
}
