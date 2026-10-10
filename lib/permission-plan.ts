import type { Mandate } from "./decision.ts";

// Compiles a saved mandate into the exact onchain spending policy that an install
// would create. Pure and inspectable: the same numbers shown to the owner are the
// numbers the policy carries. USDG has 6 decimals, so 1 cent = 10^4 raw.
export type PlanOutput = { symbol: string; token: string };

export type PermissionInstallPlan = {
  chainId: 4663;
  owner: string;
  perTradeRaw: string;
  dailyRaw: string;
  totalRaw: string;
  horizonDays: 2;
  expiresAt: number;
  outputs: PlanOutput[];
  session: "owner-wallet";
};

export type PlanError = { error: string };

const CENT_TO_USDG_RAW = 10_000n;
// The compiled Roles policy refuses longer windows and more than three outputs:
// short, narrow grants are the safety design, renewed as needed.
const HORIZON_DAYS = 2;
const MAX_OUTPUTS = 3;

export function planFromMandate(mandate: Mandate | null, owner: string,
  outputs: PlanOutput[], now = new Date()): PermissionInstallPlan | PlanError {
  if (!mandate || !Number.isInteger(mandate.version) || mandate.version < 1) {
    return { error: "Save your limits in Mandate first." };
  }
  if (!/^0x[0-9a-f]{40}$/i.test(owner)) return { error: "Verify your wallet ownership first." };
  if (!mandate.allowedSymbols.length) return { error: "Approve at least one stock symbol in Mandate." };
  if (mandate.allowedSymbols.length > MAX_OUTPUTS) {
    return { error: `An installable policy covers at most ${MAX_OUTPUTS} approved symbols; narrow your Mandate.` };
  }
  // Fail closed: a symbol without an official registry token cannot be covered by
  // an onchain output rule, so the policy is not installable with it in place.
  for (const symbol of mandate.allowedSymbols) {
    if (!outputs.some((output) => output.symbol === symbol)) {
      return { error: `No official token contract is known for ${symbol}; remove it from Mandate or wait for registry support.` };
    }
  }
  if (!Number.isSafeInteger(mandate.maxOrderCents) || mandate.maxOrderCents < 1 ||
    !Number.isSafeInteger(mandate.maxDailyBuyCents) || mandate.maxDailyBuyCents < mandate.maxOrderCents) {
    return { error: "Your saved limits are inconsistent; review Mandate." };
  }
  const perTradeRaw = BigInt(mandate.maxOrderCents) * CENT_TO_USDG_RAW;
  const dailyRaw = BigInt(mandate.maxDailyBuyCents) * CENT_TO_USDG_RAW;
  // The cumulative ceiling covers the short policy window; daily limits still bind every day.
  const totalRaw = dailyRaw * BigInt(HORIZON_DAYS);
  // Roles windows start at a UTC midnight and last exactly the horizon.
  const startsAt = now.getTime() - (now.getTime() % 86_400_000);
  return {
    chainId: 4663,
    owner: owner.toLowerCase(),
    perTradeRaw: perTradeRaw.toString(),
    dailyRaw: dailyRaw.toString(),
    totalRaw: totalRaw.toString(),
    horizonDays: 2,
    expiresAt: startsAt + HORIZON_DAYS * 86_400_000,
    outputs: outputs.filter((output) => mandate.allowedSymbols.includes(output.symbol)),
    session: "owner-wallet",
  };
}

export function planSummary(plan: PermissionInstallPlan): {
  perTrade: string; daily: string; total: string; outputs: string; expires: string;
} {
  const dollars = (raw: string) => `$${(Number(BigInt(raw) / 10_000n) / 100).toFixed(2)}`;
  return {
    perTrade: dollars(plan.perTradeRaw),
    daily: dollars(plan.dailyRaw),
    total: dollars(plan.totalRaw),
    outputs: plan.outputs.map((output) => output.symbol).join(", "),
    expires: new Date(plan.expiresAt).toLocaleDateString("en-US", { dateStyle: "medium" }),
  };
}
