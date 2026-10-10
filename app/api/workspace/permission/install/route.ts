import { env } from "cloudflare:workers";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { D1DecisionLedger } from "@/db/ledger";
import { getOwnership } from "@/db/wallet-ownership";
import { registry } from "@/lib/robinhood-chain";
import { chainTransport } from "@/lib/chain-transport";
import { inspectRoute } from "@/lib/chain-route";
import { planFromMandate } from "@/lib/permission-plan";
import { buildInstall, installationReadChecks, revocationStep, type InstallOutput } from "@/lib/install-flow";
import { checkPermissionState } from "@/app/api/workspace/orders/live/_shared";
import { safeFactoryAbi, SAFE_CONTRACTS } from "@/lib/safe-setup";
import { EXECUTION_CONTRACTS } from "@/lib/autonomy";

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
    const plan = planFromMandate(mandate, owner, tokens.map((token) => ({ symbol: token.symbol, token: token.contract })));
    if ("error" in plan) return Response.json({ error: plan.error }, { status: 422 });

    // Live economic evidence per output: the quoting tier and its slippage floor.
    const transport = chainTransport(env.ALCHEMY_API_KEY);
    const outputs: InstallOutput[] = [];
    for (const output of plan.outputs) {
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
    const { steps, compiled, policy } = build.phaseB(moduleParam as Address);
    const payload = {
      safe: build.safe, module: moduleParam, roleKey: compiled.roleKey,
      steps, revocation: revocationStep(compiled), limitations: compiled.limitations,
    };
    if (url.searchParams.get("inspect") !== "1") return Response.json(payload);
    const spec = installationReadChecks({ session: owner, compiled, policy });
    const checks = [];
    for (const check of spec) {
      let observed: string = "unreadable";
      let ok = false;
      try {
        let data: Hex;
        if (check.functionName === "allowances") {
          data = encodeFunctionData({ abi: getterAbi, functionName: "allowances", args: [check.args[0] as Hex] });
        } else if (check.functionName === "isModuleEnabled") {
          data = encodeFunctionData({ abi: getterAbi, functionName: "isModuleEnabled", args: [check.args[0] as Address] });
        } else {
          data = encodeFunctionData({ abi: getterAbi, functionName: check.functionName, args: [] });
        }
        const raw = await rpcCall(moduleParam, data, transport);
        if (check.functionName === "allowances") {
          const values = decodeFunctionResult({ abi: getterAbi, functionName: "allowances", data: raw });
          observed = values.map(String).join("/");
          const [budget] = check.expect.split(" ");
          ok = values[1].toString() === budget;
        } else {
          const value = decodeFunctionResult({ abi: getterAbi, functionName: check.functionName, data: raw });
          observed = String(value);
          ok = check.expect.toLowerCase() === observed.toLowerCase();
        }
      } catch { /* An unreadable check fails closed. */ }
      checks.push({ ...check, observed, ok });
    }
    return Response.json({ ...payload, checks, installed: checks.every((check) => check.ok) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activation unavailable." }, { status: 502 });
  }
}
