import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import type { PoolProbe, RouteEvidence } from "./chain-route.ts";
import type { StoredOutput } from "../db/active-modules.ts";
import { compileRolesPolicy, type RolesPolicy } from "./roles-permission.ts";
import { installationReadChecks } from "./install-flow.ts";
import { PILOT_MAX_DAILY_CENTS, PILOT_MAX_ORDER_CENTS } from "./pilot-policy.ts";

// Stage 3 helpers: every real order is prepared server-side, signed in the owner's
// own wallet, then reconciled against exact onchain evidence. The server never signs.

const getterAbi = parseAbi([
  "function owner() view returns (address)",
  "function avatar() view returns (address)",
  "function target() view returns (address)",
  "function isModuleEnabled(address) view returns (bool)",
  "function allowances(bytes32) view returns (uint256,uint256,uint256,uint256,uint256)",
]);

const modulesAbi = parseAbi([
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);

export type ReadbackCall = ((to: string, data: Hex, block: string) => Promise<Hex>) & { membership?: (policy: RolesPolicy, roleKey: Hex, block: string) => Promise<boolean> };

export type PolicyCheck = { label: string; expect: string; observed: string; ok: boolean };

export async function verifyPolicyReadback(
  policy: RolesPolicy,
  compiled: ReturnType<typeof compileRolesPolicy>,
  call: ReadbackCall,
  block: string,
): Promise<{ checks: PolicyCheck[]; allOk: boolean }> {
  const spec = installationReadChecks({ session: policy.session, compiled, policy });
  const checks: PolicyCheck[] = await Promise.all(spec.map(async (check) => {
    let observed = "unreadable";
    let ok = false;
    try {
      if (check.label === "Session membership") {
        if (!call.membership) throw new Error("Role membership evidence unavailable");
        const member = await call.membership(policy, compiled.roleKey, block);
        return { label: check.label, expect: "active", observed: member ? "active" : "revoked", ok: member };
      }
      let data: Hex;
      if (check.functionName === "allowances") {
        data = encodeFunctionData({ abi: getterAbi, functionName: "allowances", args: [check.args[0] as Hex] });
      } else if (check.functionName === "isModuleEnabled") {
        data = encodeFunctionData({ abi: getterAbi, functionName: "isModuleEnabled", args: [check.args[0] as Address] });
      } else {
        data = encodeFunctionData({ abi: getterAbi, functionName: check.functionName, args: [] });
      }
      const raw = await call(policy.module, data, block);
      if (check.functionName === "allowances") {
        const values = decodeFunctionResult({ abi: getterAbi, functionName: "allowances", data: raw }) as readonly bigint[];
        observed = values.map(String).join("/");
        const [budget] = check.expect.split(" ");
        const daily = check.args[0].toLowerCase() === compiled.dailyKey.toLowerCase();
        ok = values[1].toString() === budget
          && values[0] === (daily ? BigInt(budget) : 0n)
          && values[2] === (daily ? 86400n : 0n)
          && values[3] <= values[1]
          && values[4] >= BigInt(policy.startsAt) && values[4] < BigInt(policy.expiresAt);
      } else {
        const value = decodeFunctionResult({ abi: getterAbi, functionName: check.functionName, data: raw });
        observed = String(value);
        ok = check.expect.toLowerCase() === observed.toLowerCase();
      }
    } catch { /* An unreadable check fails closed. */ }
    return { label: check.label, expect: check.expect, observed, ok };
  }));
  let enabled: boolean | null = null;
  try {
    const raw = await call(policy.account, encodeFunctionData({ abi: getterAbi, functionName: "isModuleEnabled", args: [policy.module as Address] }), block);
    enabled = decodeFunctionResult({ abi: getterAbi, functionName: "isModuleEnabled", data: raw }) === true;
  } catch { /* Missing Safe authority fails closed. */ }
  checks.push({ label: "Permission enabled on the Safe", expect: "true", observed: enabled === null ? "unreadable" : String(enabled), ok: enabled === true });
  return { checks, allOk: checks.length > 0 && checks.every((check) => check.ok) };
}

export type PolicyBase = {
  session: Address;
  grantId: Hex;
  routerCodeHash: Hex;
  startsAt: number;
  expiresAt: number;
  inputRaw: string;
  dailyRaw: string;
  totalRaw: string;
  outputs: { token: Address; fee: number; tickSpacing: number; minimumOutputRaw: string }[];
};

// Finds the Steward permission among a Safe's enabled modules by running the full
// readback against each candidate. Foreign modules can never pass every check.
export async function findActivePolicyModule(
  safe: string,
  base: PolicyBase,
  call: ReadbackCall,
  block: string,
): Promise<{ policy: RolesPolicy; compiled: ReturnType<typeof compileRolesPolicy> } | null> {
  const SENTINEL = "0x0000000000000000000000000000000000000001";
  let cursor = SENTINEL;
  for (let page = 0; page < 3; page++) {
    const data = encodeFunctionData({ abi: modulesAbi, functionName: "getModulesPaginated", args: [cursor as Address, 10n] });
    let modules: readonly string[] = [];
    let next = SENTINEL;
    try {
      const decoded = decodeFunctionResult({ abi: modulesAbi, functionName: "getModulesPaginated", data: await call(safe, data, block) }) as
        readonly [readonly string[], string];
      modules = decoded[0];
      next = decoded[1];
    } catch {
      return null;
    }
    for (const moduleAddress of modules) {
      if (!/^0x[0-9a-f]{40}$/i.test(moduleAddress)) continue;
      try {
        const policy: RolesPolicy = { account: safe as Address, module: moduleAddress as Address, ...base };
        const compiled = compileRolesPolicy(policy);
        const readback = await verifyPolicyReadback(policy, compiled, call, block);
        if (readback.allOk) return { policy, compiled };
      } catch { /* A foreign module simply does not match. */ }
    }
    if (next.toLowerCase() === SENTINEL.toLowerCase()) return null;
    cursor = next;
  }
  return null;
}

export function validateLiveAmount(
  amountCents: number,
  mandate: { maxOrderCents: number; maxDailyBuyCents: number },
  spentTodayCents: number,
  limits = { maxOrderCents: PILOT_MAX_ORDER_CENTS, maxDailyCents: PILOT_MAX_DAILY_CENTS },
): { ok: true } | { ok: false; error: string } {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    return { ok: false, error: "Enter an amount of at least $0.01." };
  }
  if (amountCents > limits.maxOrderCents) {
    return { ok: false, error: `Orders stay at or under ${dollars(limits.maxOrderCents)} each.` };
  }
  if (amountCents > mandate.maxOrderCents) {
    return { ok: false, error: `Above your ${dollars(mandate.maxOrderCents)} single-trade limit.` };
  }
  const dailyCap = Math.min(mandate.maxDailyBuyCents, limits.maxDailyCents);
  if (amountCents + spentTodayCents > dailyCap) {
    return { ok: false, error: `That would pass your ${dollars(dailyCap)} daily limit (${dollars(Math.max(0, dailyCap - spentTodayCents))} left today).` };
  }
  return { ok: true };
}

// Picks the order's pool and floor from the prices locked at activation, never
// from the fresh quote. The onchain conditions pin the install-time bytes, so
// only those exact figures can ever execute; the fresh quote stays a gate
// (the locked pool must still be alive and the floor must still be reachable).
export function selectStoredFloor(route: RouteEvidence, stored: StoredOutput[]): { probe: PoolProbe; floorRaw: string } {
  const line = stored.find((output) => output.token.toLowerCase() === route.token.toLowerCase());
  if (!line) throw new Error("That stock is not covered by your recorded permission. Turn it on once more above, then order.");
  const probe = route.probes.find((entry) => entry.fee === line.fee && entry.tickSpacing === line.tickSpacing);
  if (!probe || probe.state !== "quoted" || !probe.outputRaw) {
    throw new Error(`No live price in your permission's ${route.symbol} pool right now. Try again in a moment.`);
  }
  if (BigInt(probe.outputRaw) < BigInt(line.minimumOutputRaw)) {
    throw new Error("The price moved past your locked floor. Turn the permission on once more to lock a fresh price, then order.");
  }
  return { probe, floorRaw: line.minimumOutputRaw };
}
