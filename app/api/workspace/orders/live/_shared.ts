import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { env } from "cloudflare:workers";
import { D1DecisionLedger } from "@/db/ledger";
import { getOwnership } from "@/db/wallet-ownership";
import { listSpendEvidence } from "@/db/execution-attempts";
import { CHAIN, registry } from "@/lib/robinhood-chain";
import { chainTransport } from "@/lib/chain-transport";
import { inspectRoute, type RouteEvidence } from "@/lib/chain-route";
import { planFromMandate } from "@/lib/permission-plan";
import { validatePilotMandate } from "@/lib/pilot-policy";
import { installSalts } from "@/lib/install-flow";
import { safeFactoryAbi, safeSetupPlan, SAFE_CONTRACTS } from "@/lib/safe-setup";
import { EXECUTION_CONTRACTS } from "@/lib/autonomy";
import { findActivePolicyModule, type PolicyBase } from "@/lib/live-order";

export const CHAIN_RPC = "https://rpc.mainnet.chain.robinhood.com/";

const modulesAbi = parseAbi([
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);
const SENTINEL = "0x0000000000000000000000000000000000000001";

export async function rpcCall(to: string, data: Hex, block: string, transport: typeof fetch): Promise<Hex> {
  const response = await transport(CHAIN_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, block] }),
    cache: "no-store",
  });
  const body = await response.json() as { result?: string };
  if (!body.result) throw new Error("RPC call unavailable.");
  return body.result as Hex;
}

export async function getCode(address: string, transport: typeof fetch): Promise<string> {
  const response = await transport(CHAIN_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    cache: "no-store",
  });
  const body = await response.json() as { result?: string };
  return body.result ?? "0x";
}

export async function listModules(safe: string, transport: typeof fetch): Promise<string[]> {
  const out: string[] = [];
  let cursor = SENTINEL;
  for (let page = 0; page < 3; page++) {
    const data = encodeFunctionData({ abi: modulesAbi, functionName: "getModulesPaginated", args: [cursor as Address, 10n] });
    const raw = await rpcCall(safe, data, "latest", transport);
    const [array, next] = decodeFunctionResult({ abi: modulesAbi, functionName: "getModulesPaginated", data: raw }) as
      readonly [readonly string[], string];
    for (const entry of array) if (/^0x[0-9a-f]{40}$/i.test(entry)) out.push(entry);
    if (next.toLowerCase() === SENTINEL.toLowerCase()) break;
    cursor = next;
  }
  return out;
}

// Recomputes the owner's expected Steward Safe (never trusted from the client).
export async function locateSafe(db: D1Database, userId: string) {
  const mandate = await new D1DecisionLedger(db).getMandate(userId);
  const ownership = await getOwnership(db, userId);
  if (!ownership?.verifiedAt) throw new Error("Verify your wallet ownership first.");
  if (!mandate || mandate.version < 1) throw new Error("Save your limits in Mandate first.");
  const owner = ownership.address as Address;
  const transport = chainTransport(env.ALCHEMY_API_KEY);
  const creationRaw = await rpcCall(SAFE_CONTRACTS.factory,
    encodeFunctionData({ abi: safeFactoryAbi, functionName: "proxyCreationCode" }), "latest", transport);
  const proxyCreationCode = decodeFunctionResult({ abi: safeFactoryAbi, functionName: "proxyCreationCode", data: creationRaw });
  const { safeSalt } = installSalts(owner, mandate.version);
  const setup = safeSetupPlan(owner, safeSalt, proxyCreationCode as Hex);
  return { owner, safe: setup.account as Address, mandate, transport };
}

// Compiles the exact onchain spending policy the mandate describes, with live
// pool prices for every output. Read-only: nothing is signed or sent.
export async function buildPolicyBase(located: Awaited<ReturnType<typeof locateSafe>>) {
  const { owner, safe, mandate, transport } = located;
  const pilot = validatePilotMandate(mandate);
  if (!pilot.ok) throw new Error(pilot.error);
  const registryResponse = await fetch("https://api.robinhood.com/rhj/assets", { cache: "no-store" });
  const tokens = registry(await registryResponse.json());
  const plan = planFromMandate(mandate, owner, tokens.map((token) => ({ symbol: token.symbol, token: token.contract })));
  if ("error" in plan) throw new Error(plan.error);

  const routerCode = await transport(CHAIN_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [EXECUTION_CONTRACTS.router, "latest"] }),
    cache: "no-store",
  }).then(async (response) => (await response.json() as { result?: string }).result);
  if (!routerCode || routerCode === "0x") throw new Error("Trade router code missing at the observed chain.");
  const routerCodeHash = keccak256(routerCode as Hex);
  void CHAIN;

  const perTradeAmount = (Number(BigInt(plan.perTradeRaw)) / 1_000_000).toFixed(2);
  const outputs: PolicyBase["outputs"] = [];
  for (const output of plan.outputs) {
    const route = await inspectRoute(safe, output.symbol, perTradeAmount, 50, transport);
    if (!route.best || !route.minimumOutputRaw) {
      throw new Error(`No live pool quote for ${output.symbol}; orders stay locked until every output quotes.`);
    }
    outputs.push({ token: output.token as Address, fee: route.best.fee, tickSpacing: route.best.tickSpacing,
      minimumOutputRaw: route.minimumOutputRaw });
  }
  const startsAt = plan.expiresAt / 1000 - 2 * 86400;
  const base: PolicyBase = {
    session: owner,
    grantId: keccak256(toHex(`stock-steward-grant-v1|${owner.toLowerCase()}|${mandate.version}`)),
    routerCodeHash, startsAt, expiresAt: plan.expiresAt / 1000,
    inputRaw: plan.perTradeRaw, dailyRaw: plan.dailyRaw, totalRaw: plan.totalRaw, outputs,
  };
  return { ...located, plan, base };
}

// Finds the Steward permission among the Safe's enabled modules by running the
// full onchain readback against each candidate. Foreign wallets and foreign
// modules can never satisfy these checks.
export async function assembleActivePolicyFor(db: D1Database, userId: string) {
  const built = await buildPolicyBase(await locateSafe(db, userId));
  const call = (to: string, data: Hex, block: string) => rpcCall(to, data, block, built.transport);
  const found = await findActivePolicyModule(built.safe, built.base, call, "latest");
  if (!found) throw new Error("No active Steward permission on your wallet. Activate it first, then place orders.");
  return { ...built, policy: found.policy, compiled: found.compiled };
}

// Reports what an earlier activation left onchain: the expected Safe, whether it
// exists, every module on it, and the fully verified one if there is one.
export async function checkPermissionState(db: D1Database, userId: string) {
  const located = await locateSafe(db, userId);
  let safeHasCode = false;
  let modules: string[] = [];
  try {
    safeHasCode = (await getCode(located.safe, located.transport)) !== "0x";
    if (safeHasCode) modules = await listModules(located.safe, located.transport);
  } catch { /* Unreadable chain state simply reports nothing found. */ }
  let activeModule: string | null = null;
  if (modules.length) {
    try {
      const built = await buildPolicyBase(located);
      const call = (to: string, data: Hex, block: string) => rpcCall(to, data, block, built.transport);
      const found = await findActivePolicyModule(built.safe, built.base, call, "latest");
      if (found) activeModule = found.policy.module;
    } catch { /* Partial states report the modules without a match. */ }
  }
  return { safe: located.safe, safeHasCode, modules, activeModule };
}

export async function spendTodayCents(db: D1Database, userId: string, safe: string) {
  const evidence = await listSpendEvidence(db, userId, safe, new Date());
  if (!evidence) throw new Error("Spending history is unreadable; orders stay locked.");
  return evidence.filledCents + evidence.pendingCents;
}

export type { RouteEvidence };
