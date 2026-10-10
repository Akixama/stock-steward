import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
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

export type ReadbackCall = (to: string, data: Hex, block: string) => Promise<Hex>;

export type PolicyCheck = { label: string; expect: string; observed: string; ok: boolean };

export async function verifyPolicyReadback(
  policy: RolesPolicy,
  compiled: ReturnType<typeof compileRolesPolicy>,
  call: ReadbackCall,
  block: string,
): Promise<{ checks: PolicyCheck[]; allOk: boolean }> {
  const spec = installationReadChecks({ session: policy.session, compiled, policy });
  const checks: PolicyCheck[] = [];
  for (const check of spec) {
    let observed = "unreadable";
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
      const raw = await call(policy.module, data, block);
      if (check.functionName === "allowances") {
        const values = decodeFunctionResult({ abi: getterAbi, functionName: "allowances", data: raw }) as readonly bigint[];
        observed = values.map(String).join("/");
        const [budget] = check.expect.split(" ");
        ok = values[1].toString() === budget;
      } else {
        const value = decodeFunctionResult({ abi: getterAbi, functionName: check.functionName, data: raw });
        observed = String(value);
        ok = check.expect.toLowerCase() === observed.toLowerCase();
      }
    } catch { /* An unreadable check fails closed. */ }
    checks.push({ label: check.label, expect: check.expect, observed, ok });
  }
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
    for (const module of modules) {
      if (!/^0x[0-9a-f]{40}$/i.test(module)) continue;
      try {
        const policy: RolesPolicy = { account: safe as Address, module: module as Address, ...base };
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
): { ok: true } | { ok: false; error: string } {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    return { ok: false, error: "Enter an amount of at least $0.01." };
  }
  if (amountCents > PILOT_MAX_ORDER_CENTS) {
    return { ok: false, error: "Pilot trades stay at or under $10 each." };
  }
  if (amountCents > mandate.maxOrderCents) {
    return { ok: false, error: `Above your ${dollars(mandate.maxOrderCents)} single-trade limit.` };
  }
  const dailyCap = Math.min(mandate.maxDailyBuyCents, PILOT_MAX_DAILY_CENTS);
  if (amountCents + spentTodayCents > dailyCap) {
    return { ok: false, error: `That would pass your ${dollars(dailyCap)} daily limit (${dollars(Math.max(0, dailyCap - spentTodayCents))} left today).` };
  }
  return { ok: true };
}
