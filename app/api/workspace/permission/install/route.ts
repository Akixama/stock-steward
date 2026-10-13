import { withRoleMembership } from "@/lib/role-membership";
import { env } from "cloudflare:workers";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getOwnership } from "@/db/wallet-ownership";
import { registry } from "@/lib/robinhood-chain";
import { chainTransport } from "@/lib/chain-transport";
import { inspectRoute } from "@/lib/chain-route";
import { planFromMandate } from "@/lib/permission-plan";
import { buildInstall, PERMIT2, revocationStep, type InstallOutput } from "@/lib/install-flow";
import { buildPolicyBase, checkPermissionState, locateSafe, rpcCall as liveRpcCall } from "@/app/api/workspace/orders/live/_shared";
import { compileRolesPolicy } from "@/lib/roles-permission";
import { verifyPolicyReadback } from "@/lib/live-order";
import { getActiveModule, moduleRecordContext, saveActiveModule } from "@/db/active-modules";
import { VENUE } from "@/lib/chain-route";
import { MULTISEND, safeFactoryAbi, SAFE_CONTRACTS } from "@/lib/safe-setup";
import { EXECUTION_CONTRACTS } from "@/lib/autonomy";
import { installedOutputs } from "@/lib/installed-outputs";

// Assembles the exact owner-signed install transactions. The server never signs: every
// step is sent by the owner's own wallet and every effect is read back before the next.
// GET /api/workspace/permission/install            -> phase A (wallet + module creation)
// GET /api/workspace/permission/install?module=0x… -> phase B (enable + policy config)
// …&inspect=1                                      -> live readback of the installed state

const CHAIN_RPC = "https://rpc.mainnet.chain.robinhood.com/";

const getterAbi = parseAbi([
  "function owner() view returns (address)",
  "function avatar() view returns (address)",
  "function target() view returns (address)",
  "function isModuleEnabled(address) view returns (bool)",
  "function allowances(bytes32) view returns (uint256,uint256,uint256,uint256,uint256)",
]);
const ercAllowanceAbi = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
const permitAllowanceAbi = parseAbi(["function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)"]);

// Swap funding is part of an installed permission: the trade router pulls the
// exact input through the Permit2 helper, and both bounded approvals are set
// during activation. Without them every order reverts before it starts.
async function fundingReady(account: string, inputRaw: string, transport: typeof fetch): Promise<boolean> {
  try {
    const ercRaw = await rpcCall(VENUE.settlement,
      encodeFunctionData({ abi: ercAllowanceAbi, functionName: "allowance", args: [account as Address, PERMIT2] }), transport);
    const permitRaw = await rpcCall(PERMIT2,
      encodeFunctionData({ abi: permitAllowanceAbi, functionName: "allowance",
        args: [account as Address, VENUE.settlement as Address, EXECUTION_CONTRACTS.router as Address] }), transport);
    const ercAllow = decodeFunctionResult({ abi: ercAllowanceAbi, functionName: "allowance", data: ercRaw }) as bigint;
    const decoded = decodeFunctionResult({ abi: permitAllowanceAbi, functionName: "allowance", data: permitRaw }) as unknown as readonly [unknown, unknown, unknown];
    return ercAllow >= BigInt(inputRaw) && BigInt(String(decoded[0])) >= BigInt(inputRaw)
      && Number(decoded[1]) * 1000 > Date.now() + 60000;
  } catch { return false; }
}

async function rpcCall(to: string, data: Hex, transport: typeof fetch): Promise<Hex> {
  const response = await transport(CHAIN_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    cache: "no-store",
  });
  const body = await response.json() as { result?: string; error?: unknown };
  if (!body.result) throw new Error("RPC call unavailable.");
  return body.result as Hex;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const url = new URL(request.url);
    // Reports what an earlier activation left onchain so the panel can resume
    // instead of re-sending steps that would always fail.
    if (url.searchParams.get("check") === "1") {
      return Response.json(await checkPermissionState(env.DB, user.userId));
    }
    const moduleParam = url.searchParams.get("module");
    const mandate = await new D1DecisionLedger(env.DB).getMandate(user.userId);
    const ownership = await getOwnership(env.DB, user.userId);
    if (!ownership?.verifiedAt) return Response.json({ error: "Verify your wallet ownership first." }, { status: 409 });
    const owner = ownership.address as Address;

    const registryResponse = await fetch("https://api.robinhood.com/rhj/assets", { cache: "no-store" });
    const tokens = registry(await registryResponse.json());
    const inspecting = url.searchParams.get("inspect") === "1";
    const existing = inspecting && mandate ? await getActiveModule(env.DB, user.userId, mandate.version) : null;
    const saved = existing?.module.toLowerCase() === moduleParam?.toLowerCase() ? existing : null;
    const plan = planFromMandate(mandate, owner, tokens.map((token) => ({ symbol: token.symbol, token: token.contract })), saved ? new Date(saved.startsAt * 1000) : new Date());
    if ("error" in plan) return Response.json({ error: plan.error }, { status: 422 });

    // Live economic evidence per output: the quoting tier and its slippage floor.
    const transport = chainTransport(env.ALCHEMY_API_KEY);
    const outputs: InstallOutput[] = [];
    for (const output of plan.outputs) {
      const stored = saved?.outputs?.find(item => item.token.toLowerCase() === output.token.toLowerCase());
      if (stored) { outputs.push({ ...stored, token: stored.token as Address }); continue; }
      const amount = (Number(BigInt(plan.perTradeRaw)) / 1_000_000).toFixed(2);
      const route = await inspectRoute(owner, output.symbol, amount, 50, transport);
      if (!route.best || !route.minimumOutputRaw) {
        return Response.json({ error: `No live pool quote for ${output.symbol}; the policy is not installable until every output quotes.` }, { status: 422 });
      }
      outputs.push({ token: output.token as Address, fee: route.best.fee, tickSpacing: route.best.tickSpacing,
        minimumOutputRaw: route.minimumOutputRaw });
    }

    const creationRaw = await rpcCall(SAFE_CONTRACTS.factory,
      encodeFunctionData({ abi: safeFactoryAbi, functionName: "proxyCreationCode" }), transport);
    const proxyCreationCode = decodeFunctionResult({ abi: safeFactoryAbi, functionName: "proxyCreationCode", data: creationRaw });
    const routerCode = await transport(CHAIN_RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [EXECUTION_CONTRACTS.router, "latest"] }),
      cache: "no-store",
    }).then(async (response) => (await response.json() as { result?: string }).result);
    if (!routerCode || routerCode === "0x") return Response.json({ error: "Trade router code missing at the observed chain." }, { status: 502 });
    const routerCodeHash = keccak256(routerCode as Hex);

    const startsAt = plan.expiresAt / 1000 - 2 * 86400;
    const build = buildInstall({
      owner, policyVersion: mandate!.version,
      proxyCreationCode: proxyCreationCode as Hex,
      policyBase: {
        session: owner,
        grantId: keccak256(toHex(`stock-steward-grant-v1|${owner.toLowerCase()}|${mandate!.version}`)),
        routerCodeHash, startsAt, expiresAt: plan.expiresAt / 1000,
        inputRaw: plan.perTradeRaw, dailyRaw: plan.dailyRaw, totalRaw: plan.totalRaw, outputs,
      },
    });

    if (!moduleParam) {
      return Response.json({
        safe: build.safe, steps: build.stepsA, window: { startsAt, expiresAt: plan.expiresAt / 1000 },
        outputs: plan.outputs.map((output, index) => ({ ...output, pool: outputs[index] })),
        routerCodeHash, notice: "Every step is signed by your own wallet. The server computes calldata and verifies effects; it can never sign.",
      });
    }
    if (!/^0x[0-9a-f]{40}$/i.test(moduleParam)) return Response.json({ error: "Invalid module address." }, { status: 400 });
    // Idempotent resume: enabling an already-enabled module always reverts, so
    // the enable call is omitted when the chain already shows membership. Every
    // other call safely overwrites, so only this one needs the guard.
    let skipEnable = false;
    try {
      const membershipRaw = await rpcCall(build.safe,
        encodeFunctionData({ abi: getterAbi, functionName: "isModuleEnabled", args: [moduleParam as Address] }), transport);
      skipEnable = decodeFunctionResult({ abi: getterAbi, functionName: "isModuleEnabled", data: membershipRaw }) === true;
    } catch { /* Unreadable membership keeps every step. */ }
    const { steps: liveSteps, batched: fullBatch, compiled, policy } = build.phaseB(moduleParam as Address, skipEnable);
    // The one-signature path is offered only while the audited batch helper at
    // its canonical address still carries exactly the pinned code. Anything
    // else falls back to the step-by-step path, never to a blind batch.
    let batched: typeof fullBatch | undefined = fullBatch;
    try {
      const helperCode = await transport(CHAIN_RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [MULTISEND.address, "latest"] }),
        cache: "no-store",
      }).then(async (response) => (await response.json() as { result?: string }).result);
      if (!helperCode || helperCode === "0x" || keccak256(helperCode as Hex).toLowerCase() !== MULTISEND.runtimeHash.toLowerCase()) {
        batched = undefined;
      }
    } catch { batched = undefined; }
    const payload = {
      safe: build.safe, module: moduleParam, roleKey: compiled.roleKey,
      steps: liveSteps, batched, revocation: revocationStep(compiled, policy.account, policy.session), limitations: compiled.limitations,
      // The exact prices these steps lock in. The wallet posts them back when
      // recording, so orders can carry them verbatim; the onchain conditions
      // pin these install-time bytes and would reject any fresh quote.
      outputs: policy.outputs,
    };
    if (url.searchParams.get("inspect") !== "1") return Response.json(payload);
    const { checks } = await verifyPolicyReadback(policy, compiled,
      withRoleMembership((to, data) => rpcCall(to, data, transport), transport), "latest");
    const funded = await fundingReady(build.safe as string, policy.inputRaw, transport);
    checks.push({ label: "Swap funding approvals", expect: "ready", observed: funded ? "ready" : "missing or unreadable", ok: funded });
    return Response.json({ ...payload, checks, installed: checks.every((check) => check.ok) && funded });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activation unavailable." }, { status: 502 });
  }
}

// Records the wallet's verified permission module so real orders can find it
// without searching history. The address is never trusted: the exact policy is
// rebuilt from the saved mandate and every check is re-proved live before the
// record is kept. A foreign or stale module simply fails the readback.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  try {
    const { module, outputs } = await request.json() as { module?: string; outputs?: unknown };
    if (!module || !/^0x[0-9a-f]{40}$/i.test(module)) {
      return Response.json({ error: "Invalid module address." }, { status: 400 });
    }
    const located = await locateSafe(env.DB, user.userId);
    const current = await getActiveModule(env.DB, user.userId, located.mandate.version).catch(() => null);
    const context = moduleRecordContext(current, module, outputs);
    if (outputs !== undefined && context.outputs === null) {
      return Response.json({ error: "Install-time prices are missing or malformed. Refresh the permission check." }, { status: 422 });
    }
    const built = await buildPolicyBase(located, context.outputs?.map(line => ({ ...line, token: line.token as Address })), context.window);
    const call = withRoleMembership((to: string, data: Hex, block: string) => liveRpcCall(to, data, block, built.transport), built.transport);
    const policy = { account: built.safe as Address, module: module as Address, ...built.base };
    const compiled = compileRolesPolicy(policy);
    const readback = await verifyPolicyReadback(policy, compiled, call, "latest");
    if (!readback.allOk) {
      return Response.json({ error: `Permission verification failed: ${readback.checks.filter(check => !check.ok).map(check => check.label).join(", ")}. Refresh the permission check before signing again.` }, { status: 422 });
    }
    // Recorded outputs must be the install-time prices from the steps response:
    // the onchain conditions pin those exact bytes. An absent list keeps any
    // earlier record for the same module; anything malformed is refused.
    let locked = context.outputs;
    if (!locked && outputs === undefined) {
      const read = async (method: string, params: unknown[]) => {
        const fetcher = method === "eth_getLogs" ? fetch : built.transport;
        const response = await fetcher(CHAIN_RPC, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000) });
        const body = await response.json() as { result?: unknown; error?: unknown };
        if (!response.ok || body.error || body.result === undefined) throw new Error("Installed scope history unavailable");
        return body.result;
      };
      const head = BigInt(String(await read("eth_blockNumber", [])));
      const logs = await read("eth_getLogs", [{ address: module, fromBlock: toHex(head > 10000n ? head - 10000n : 0n), toBlock: toHex(head) }]);
      if (!Array.isArray(logs) || logs.length > 1000) throw new Error("Installed scope history unavailable");
      locked = installedOutputs(policy, logs);
    }
    if (outputs !== undefined && locked === null) {
      return Response.json({ error: "Locked prices missing or malformed. Re-run activation so they are recorded." }, { status: 422 });
    }
    await saveActiveModule(env.DB, user.userId, built.mandate.version, built.safe, module, locked, new Date(), { startsAt: built.base.startsAt, expiresAt: built.base.expiresAt });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Module record unavailable." }, { status: 502 });
  }
}
