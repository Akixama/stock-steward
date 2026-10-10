import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { compileRolesPolicy, type RolesPolicy } from "./roles-permission.ts";
import { findActivePolicyModule, validateLiveAmount, verifyPolicyReadback, type ReadbackCall } from "./live-order.ts";

const SAFE = "0x1111111111111111111111111111111111111111" as Address;
const MODULE = "0x2222222222222222222222222222222222222222" as Address;
const OWNER = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;

const getterAbi = parseAbi([
  "function owner() view returns (address)",
  "function avatar() view returns (address)",
  "function target() view returns (address)",
  "function isModuleEnabled(address) view returns (bool)",
  "function allowances(bytes32) view returns (uint256,uint256,uint256,uint256,uint256)",
]);

function testPolicy(): RolesPolicy {
  const startsAt = Math.floor(Date.now() / 86_400_000) * 86_400;
  return {
    account: SAFE, module: MODULE, session: OWNER,
    grantId: keccak256(toHex("grant")),
    routerCodeHash: keccak256(toHex("router")),
    startsAt, expiresAt: startsAt + 172_800,
    inputRaw: "10000000", dailyRaw: "50000000", totalRaw: "100000000",
    outputs: [{ token: TOKEN, fee: 500, tickSpacing: 10, minimumOutputRaw: "1000000000000000000" }],
  };
}

function goodCall(policy: RolesPolicy, compiled: ReturnType<typeof compileRolesPolicy>): ReadbackCall {
  return async (to: string, data: Hex) => {
    assert.equal(to.toLowerCase(), policy.module.toLowerCase());
    const decoded = decodeFunctionData({ abi: getterAbi, data });
    if (decoded.functionName === "isModuleEnabled") {
      return encodeFunctionResult({ abi: getterAbi, functionName: "isModuleEnabled", result: true });
    }
    if (decoded.functionName === "allowances") {
      const key = (decoded.args as readonly [Hex])[0];
      const max = key.toLowerCase() === compiled.dailyKey.toLowerCase()
        ? BigInt(policy.dailyRaw) / BigInt(policy.inputRaw)
        : BigInt(policy.totalRaw) / BigInt(policy.inputRaw);
      return encodeFunctionResult({ abi: getterAbi, functionName: "allowances", result: [0n, max, max, 86400n, 0n] });
    }
    return encodeFunctionResult({ abi: getterAbi, functionName: decoded.functionName as "owner", result: policy.account });
  };
}

test("a fully matching permission passes every readback check", async () => {
  const policy = testPolicy();
  const compiled = compileRolesPolicy(policy);
  const { allOk, checks } = await verifyPolicyReadback(policy, compiled, goodCall(policy, compiled), "latest");
  assert.equal(allOk, true);
  assert.equal(checks.length, 6);
});

test("a foreign module fails the readback", async () => {
  const policy = testPolicy();
  const compiled = compileRolesPolicy(policy);
  const wrong: ReadbackCall = async (to: string, data: Hex) => {
    if (to.toLowerCase() !== policy.module.toLowerCase()) throw Error("wrong module");
    return goodCall(policy, compiled)(to, data, "latest");
  };
  const other = { ...policy, module: "0x5555555555555555555555555555555555555555" as Address };
  const { allOk } = await verifyPolicyReadback(other, compiled, wrong, "latest");
  assert.equal(allOk, false);
});

test("module discovery finds the matching permission and skips strangers", async () => {
  const policy = testPolicy();
  const compiled = compileRolesPolicy(policy);
  const modulesAbi = parseAbi([
    "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
  ]);
  const call: ReadbackCall = async (to: string, data: Hex) => {
    try {
      const decoded = decodeFunctionData({ abi: modulesAbi, data });
      assert.equal(decoded.functionName, "getModulesPaginated");
      return encodeFunctionResult({
        abi: modulesAbi, functionName: "getModulesPaginated",
        result: [
          ["0x6666666666666666666666666666666666666666", policy.module],
          "0x0000000000000000000000000000000000000001",
        ],
      });
    } catch {
      return goodCall(policy, compiled)(to, data, "latest");
    }
  };
  const { session, grantId, routerCodeHash, startsAt, expiresAt, inputRaw, dailyRaw, totalRaw, outputs } = policy;
  const found = await findActivePolicyModule(
    policy.account,
    { session, grantId, routerCodeHash, startsAt, expiresAt, inputRaw, dailyRaw, totalRaw, outputs },
    call, "latest",
  );
  assert.ok(found);
  assert.equal(found.policy.module.toLowerCase(), policy.module.toLowerCase());
});

test("live amounts respect pilot caps and the daily remainder", () => {
  const mandate = { maxOrderCents: 1_000, maxDailyBuyCents: 5_000 };
  assert.equal(validateLiveAmount(1_000, mandate, 0).ok, true);
  assert.equal(validateLiveAmount(0, mandate, 0).ok, false);
  assert.equal(validateLiveAmount(1_001, mandate, 0).ok, false);
  assert.equal(validateLiveAmount(500, mandate, 4_600).ok, false);
  assert.equal(validateLiveAmount(400, mandate, 4_600).ok, true);
  const small = { maxOrderCents: 500, maxDailyBuyCents: 2_000 };
  assert.equal(validateLiveAmount(600, small, 0).ok, false);
  assert.equal(validateLiveAmount(500, small, 0).ok, true);
});
