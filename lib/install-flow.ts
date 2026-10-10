import { encodeFunctionData, keccak256, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { safeSetupPlan } from "./safe-setup.ts";
import { rolesDeploymentCall, compileRolesPolicy, type RolesPolicy } from "./roles-permission.ts";

// The owner-signed install of the bounded spending permission. Every step is a plain
// transaction the owner's own wallet sends; the server computes calldata and verifies
// effects but never holds a key and can never sign. The policy itself is the guard:
// the Roles module rejects anything outside the owner's limits onchain.
export type InstallStep = {
  key: string;
  label: string;
  to: Address;
  data: Hex;
  verify: string;
};

export type InstallOutput = { token: Address; fee: number; tickSpacing: number; minimumOutputRaw: string };

export type InstallPolicyBase = {
  session: Address;
  grantId: Hex;
  routerCodeHash: Hex;
  startsAt: number;
  expiresAt: number;
  inputRaw: string;
  dailyRaw: string;
  totalRaw: string;
  outputs: InstallOutput[];
};

const safeAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)",
  "function enableModule(address module)",
]);
const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Deterministic salts: a retried install targets the same Safe and module addresses. */
export function installSalts(owner: string, policyVersion: number): { safeSalt: Hex; moduleSalt: Hex } {
  if (!/^0x[0-9a-f]{40}$/i.test(owner) || !Number.isSafeInteger(policyVersion) || policyVersion < 1) {
    throw new Error("Invalid install identity.");
  }
  const base = keccak256(toHex(`stock-steward-install-v1|${owner.toLowerCase()}|${policyVersion}`));
  return { safeSalt: pad(base, { size: 32 }), moduleSalt: pad(keccak256(toHex(`${base}|module`)), { size: 32 }) };
}

/**
 * Builds the exact transaction sequence. Phase A creates the owner Safe and the Roles
 * module (fully precomputable). Phase B installs the policy once the module address is
 * known from the creation receipt: enable the module, then the five config calls.
 * The owner signature inside Safe execTransaction is the prevalidated form, which only
 * works when the owner itself sends the transaction — exactly what a wallet does.
 */
export function buildInstall(input: {
  owner: Address;
  policyVersion: number;
  policyBase: InstallPolicyBase;
  proxyCreationCode: Hex;
}): {
  safe: Address;
  policyBase: InstallPolicyBase;
  stepsA: InstallStep[];
  phaseB: (module: Address) => {
    policy: RolesPolicy;
    steps: InstallStep[];
    compiled: ReturnType<typeof compileRolesPolicy>;
  };
} {
  const { owner, policyVersion, policyBase, proxyCreationCode } = input;
  if (!/^0x[0-9a-f]{40}$/i.test(owner)) throw new Error("Invalid owner wallet.");
  // Phase one is owner-signed only: the bounded role may start with no signer other
  // than the owner's own wallet. (The guarded worker signer is a later, separate step.)
  if (policyBase.session.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Phase-one install grants the role to the owner wallet only.");
  }
  const { safeSalt, moduleSalt } = installSalts(owner, policyVersion);
  const setup = safeSetupPlan(owner as Address, safeSalt, proxyCreationCode);
  const moduleCall = rolesDeploymentCall(setup.account as Address, moduleSalt);
  const stepsA: InstallStep[] = [
    {
      key: "create_safe", label: "Create your owner-controlled Steward wallet",
      to: setup.call.to as Address, data: setup.call.data,
      verify: "A ProxyCreation event names the new wallet; it is owned only by you.",
    },
    {
      key: "create_module", label: "Create the bounded-permission module",
      to: moduleCall.to as Address, data: moduleCall.data as Hex,
      verify: "A ModuleProxyCreation event names the module that will enforce your limits.",
    },
  ];
  const phaseB = (module: Address) => {
    if (!/^0x[0-9a-f]{40}$/i.test(module)) throw new Error("Invalid module address.");
    const policy: RolesPolicy = {
      account: setup.account as Address, module,
      session: policyBase.session, grantId: policyBase.grantId,
      routerCodeHash: policyBase.routerCodeHash,
      startsAt: policyBase.startsAt, expiresAt: policyBase.expiresAt,
      inputRaw: policyBase.inputRaw, dailyRaw: policyBase.dailyRaw, totalRaw: policyBase.totalRaw,
      outputs: policyBase.outputs,
    };
    const compiled = compileRolesPolicy(policy);
    const ownerSignature = (pad(owner as Address, { size: 32 }) + "0".repeat(64) + "01") as Hex;
    const wrap = (key: string, label: string, to: Address, data: Hex, verify: string): InstallStep => ({
      key, label,
      to: policy.account as Address,
      data: encodeFunctionData({
        abi: safeAbi, functionName: "execTransaction",
        args: [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature],
      }),
      verify,
    });
    const steps: InstallStep[] = [
      wrap("enable_module", "Enable the permission module on your wallet", policy.module as Address,
        encodeFunctionData({ abi: safeAbi, functionName: "enableModule", args: [policy.module as Address] }),
        "Your wallet lists the module as enabled; nothing else is trusted."),
      ...compiled.calls.map((call, index) => wrap(
        ["scope_target", "scope_function", "daily_quota", "total_quota", "grant_role"][index],
        ["Pin the approved trade target", "Pin the exact trade shape", "Set the daily quota", "Set the total quota", "Grant the bounded role"][index],
        call.to as Address, call.data as Hex,
        "Configuration recorded on the module; membership last, so a partial activation grants nothing.")),
    ];
    return { policy, steps, compiled };
  };
  return { safe: setup.account as Address, policyBase, stepsA, phaseB };
}

export type InstallReadCheck = { label: string; functionName: "owner" | "avatar" | "target" | "isModuleEnabled" | "allowances"; args: string[]; expect: string };

/** The readback a client (or server) should run after the last step, before celebrating. */
export function installationReadChecks(input: {
  session: Address; compiled: ReturnType<typeof compileRolesPolicy>;
  policy: RolesPolicy;
}): InstallReadCheck[] {
  const { session, compiled, policy } = input;
  const dailyMax = BigInt(policy.dailyRaw) / BigInt(policy.inputRaw);
  const totalMax = BigInt(policy.totalRaw) / BigInt(policy.inputRaw);
  return [
    { label: "Module owner", functionName: "owner", args: [], expect: policy.account },
    { label: "Module avatar", functionName: "avatar", args: [], expect: policy.account },
    { label: "Module target", functionName: "target", args: [], expect: policy.account },
    { label: "Session membership", functionName: "isModuleEnabled", args: [session], expect: "true" },
    { label: "Daily quota", functionName: "allowances", args: [compiled.dailyKey], expect: `${dailyMax} buys per 86400s` },
    { label: "Total quota", functionName: "allowances", args: [compiled.totalKey], expect: `${totalMax} buys total` },
  ];
}

/** The exact owner revocation transaction; calling it removes the bounded role at once. */
export function revocationStep(compiled: ReturnType<typeof compileRolesPolicy>): InstallStep {
  return {
    key: "revoke", label: "Revoke the bounded role (owner action)",
    to: compiled.revocation.to as Address, data: compiled.revocation.data as Hex,
    verify: "The session can no longer execute any approved call after this lands.",
  };
}
