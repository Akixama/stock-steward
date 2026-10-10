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
import { ROLES_CONTRACTS } from "@/lib/roles-permission";

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

// A module deployed but never enabled never appears in the Safe's module list,
// yet re-creating it always reverts. Creation events name every proxy this
// factory ever deployed, so the owner's leftover is found by asking each one
// who its owner is.
export async function findUnenabledModule(safe: string, transport: typeof fetch): Promise<string | null> {
  try {
    const signature = keccak256(toHex("ModuleProxyCreation(address,address)"));
    const masterTopic = `0x${"0".repeat(24)}${ROLES_CONTRACTS.roles.slice(2).toLowerCase()}`;
    // The factory event carries proxy and mastercopy as indexed topics with
    // empty data. Filter by signature alone and narrow locally: some endpoints
    // reject null topic wildcards, and only the mastercopy topic tells our
    // modules apart from everyone else's.
    const readLogs = async (fetcher: (body: unknown) => Promise<{ result?: { topics?: string[] }[]; error?: unknown }>,
      from: bigint, to: bigint) => {
      const body = await fetcher({ jsonrpc: "2.0", id: 1, method: "eth_getLogs",
        params: [{ address: ROLES_CONTRACTS.factory, topics: [signature],
          fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] });
      if (body.error || !Array.isArray(body.result)) throw new Error("Log scan unavailable.");
      return body.result;
    };
    const readOwners = async (fetcher: (body: unknown) => Promise<{ id: number; result?: string }[]>,
      proxies: string[]) => {
      const batch = proxies.map((proxy, index) => ({ jsonrpc: "2.0", id: index + 1, method: "eth_call",
        params: [{ to: proxy, data: "0x8da5cb5b" }, "latest"] }));
      const results = await fetcher(batch);
      if (!Array.isArray(results)) return null;
      for (const [index, proxy] of proxies.entries()) {
        const owner = results.find((row) => row.id === index + 1)?.result;
        if (typeof owner === "string" && owner.toLowerCase().endsWith(safe.slice(2).toLowerCase())) return proxy;
      }
      return null;
    };
    const proxiesOf = (logs: { topics?: string[] }[]) => [...new Set(logs
      .filter((entry) => entry.topics?.[2]?.toLowerCase() === masterTopic)
      .map((entry) => entry.topics?.[1])
      .filter((topic): topic is string => typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic))
      .map((topic) => `0x${topic.slice(-40)}`))].slice(-300);
    const post = async (sender: (url: string, init: RequestInit) => Promise<unknown>, body: unknown) =>
      (await sender(CHAIN_RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(25000),
      }) as Response).json();
    const pub = async (body: unknown) => post(fetch as (url: string, init: RequestInit) => Promise<unknown>, body) as
      Promise<{ result?: { topics?: string[] }[]; error?: unknown }>;
    const pubBatch = async (body: unknown) => post(fetch as (url: string, init: RequestInit) => Promise<unknown>, body) as
      Promise<{ id: number; result?: string }[]>;
    const meta = async (body: unknown) => post(transport as (url: string, init: RequestInit) => Promise<unknown>, body) as
      Promise<{ result?: unknown; id: number; error?: unknown }>;
    const metaLogs = async (body: unknown) => meta(body) as Promise<{ result?: { topics?: string[] }[]; error?: unknown }>;
    const metaBatch = async (body: unknown) => (await meta(body) as unknown) as { id: number; result?: string }[];
    // Fast path: one wide window on the public endpoint.
    try {
      const head = await fetch(CHAIN_RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        cache: "no-store", signal: AbortSignal.timeout(15000),
      }).then(async (r) => (await r.json() as { result?: string }).result);
      if (head && /^0x[0-9a-f]+$/i.test(head)) {
        const latest = BigInt(head);
        const logs = await readLogs(pub, latest - 9_000_000n > 0n ? latest - 9_000_000n : 0n, latest);
        const match = await readOwners(pubBatch, proxiesOf(logs));
        if (match) return match;
      }
    } catch { /* Fall through to the metered walk below. */ }
    // Slow path: small adaptive windows over the metered transport.
    try {
      const head = await meta({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
      if (typeof head.result !== "string" || !/^0x[0-9a-f]+$/i.test(head.result)) return null;
      let cursor = BigInt(head.result as string);
      let size = 50_000n;
      let scanned = 0n;
      while (scanned < 500_000n && cursor > 0n) {
        const from = cursor - size > 0n ? cursor - size : 0n;
        let logs: { topics?: string[] }[];
        try {
          logs = await readLogs(metaLogs, from, cursor);
        } catch {
          size = size / 2n;
          if (size < 2_000n) break;
          continue;
        }
        const match = await readOwners(metaBatch, proxiesOf(logs));
        if (match) return match;
        scanned += cursor - from;
        cursor = from;
        size = 50_000n;
        if (from === 0n) break;
      }
    } catch { /* Unreadable history simply reports nothing found. */ }
    return null;
  } catch { /* An unreadable history simply reports nothing found. */ return null; }
}

// Reports what an earlier activation left onchain: the expected Safe, whether it
// exists, every module enabled on it, and a deployed-but-never-enabled leftover
// that re-creation could never replace. Deliberately light (a handful of calls)
// so it answers inside worker limits; the full readback that decides anything
// runs later through the inspect route, never here.
export async function checkPermissionState(db: D1Database, userId: string) {
  const located = await locateSafe(db, userId);
  let safeHasCode = false;
  let modules: string[] = [];
  try {
    safeHasCode = (await getCode(located.safe, located.transport)) !== "0x";
    if (safeHasCode) modules = await listModules(located.safe, located.transport);
  } catch { /* Unreadable chain state simply reports nothing found. */ }
  const staleModule = safeHasCode
    ? await findUnenabledModule(located.safe, located.transport)
    : null;
  return { safe: located.safe, safeHasCode, modules, staleModule };
}

export async function spendTodayCents(db: D1Database, userId: string, safe: string) {
  const evidence = await listSpendEvidence(db, userId, safe, new Date());
  if (!evidence) throw new Error("Spending history is unreadable; orders stay locked.");
  return evidence.filledCents + evidence.pendingCents;
}

export type { RouteEvidence };
