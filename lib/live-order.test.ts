import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { compileRolesPolicy, type RolesPolicy } from "./roles-permission.ts";
import { findActivePolicyModule, selectStoredFloor, validateLiveAmount, verifyPolicyReadback, type ReadbackCall } from "./live-order.ts";
import type { RouteEvidence } from "./chain-route.ts";

const SAFE = "0x1111111111111111111111111111111111111111" as Address;
const MODULE = "0x2222222222222222222222222222222222222222" as Address;
const OWNER = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x4444444444444444444444444444444444444444" as Address;

test("orders preserve the installed pool and floor even when a different pool quotes better", () => {
  const locked = { fee: 500, tickSpacing: 10, state: "quoted", outputRaw: "120" };
  const route = { token: TOKEN, symbol: "AAPL", probes: [locked, { fee: 3000, tickSpacing: 60, state: "quoted", outputRaw: "999" }] } as unknown as RouteEvidence;
  const stored = [{ token: TOKEN, fee: 500, tickSpacing: 10, minimumOutputRaw: "100" }];
  assert.deepEqual(selectStoredFloor(route, stored), { probe: locked, floorRaw: "100" });
  assert.throws(() => selectStoredFloor({ ...route, probes: [{ ...route.probes[0], outputRaw: "99" }] }, stored), /locked floor/);
  assert.throws(() => selectStoredFloor({ ...route, probes: [] }, stored), /No live price/);
  assert.throws(() => selectStoredFloor(route, []), /not covered/);
});

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
  const call: ReadbackCall = async (to: string, data: Hex) => {
    assert.ok([policy.module.toLowerCase(), policy.account.toLowerCase()].includes(to.toLowerCase()));
    const decoded = decodeFunctionData({ abi: getterAbi, data });
    if (decoded.functionName === "isModuleEnabled") {
      return encodeFunctionResult({ abi: getterAbi, functionName: "isModuleEnabled", result: true });
    }
    if (decoded.functionName === "allowances") {
      const key = (decoded.args as readonly [Hex])[0];
      const max = key.toLowerCase() === compiled.dailyKey.toLowerCase()
        ? BigInt(policy.dailyRaw) / BigInt(policy.inputRaw)
        : BigInt(policy.totalRaw) / BigInt(policy.inputRaw);
      const daily = key.toLowerCase() === compiled.dailyKey.toLowerCase();
      return encodeFunctionResult({ abi: getterAbi, functionName: "allowances", result: [daily ? max : 0n, max, daily ? 86400n : 0n, max, BigInt(policy.startsAt)] });
    }
    return encodeFunctionResult({ abi: getterAbi, functionName: decoded.functionName as "owner", result: policy.account });
  };
  call.membership = async candidate => candidate.module.toLowerCase() === policy.module.toLowerCase();
  return call;
}

test("a fully matching permission passes every readback check", async () => {
  const policy = testPolicy();
  const compiled = compileRolesPolicy(policy);
  const { allOk, checks } = await verifyPolicyReadback(policy, compiled, goodCall(policy, compiled), "latest");
  assert.equal(allOk, true);
  assert.equal(checks.length, 7);
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

test("module membership cannot substitute for Safe authorization", async () => {
  const policy = testPolicy();
  const compiled = compileRolesPolicy(policy);
  const call: ReadbackCall = async (to, data, block) => to.toLowerCase() === policy.account.toLowerCase()
    ? encodeFunctionResult({ abi: getterAbi, functionName: "isModuleEnabled", result: false })
    : goodCall(policy, compiled)(to, data, block);
  call.membership = async () => true;
  const readback = await verifyPolicyReadback(policy, compiled, call, "latest");
  assert.equal(readback.allOk, false);
  assert.equal(readback.checks.at(-1)?.ok, false);
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
  call.membership = async () => true;
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
test('correct maximum alone cannot hide a changed quota refill schedule',async()=>{const policy=testPolicy(),compiled=compileRolesPolicy(policy),base=goodCall(policy,compiled);const call:ReadbackCall=async(to,data,block)=>{if(data.startsWith(encodeFunctionResult({abi:getterAbi,functionName:'owner',result:policy.account}).slice(0,0)+'0x')){try{const d=decodeFunctionData({abi:getterAbi,data});if(d.functionName==='allowances')return encodeFunctionResult({abi:getterAbi,functionName:'allowances',result:[999n,5n,1n,5n,BigInt(policy.startsAt)]});}catch{}}return base(to,data,block);};assert.equal((await verifyPolicyReadback(policy,compiled,call,'latest')).allOk,false);});

test('revoked role blocks readback even while modules and quotas remain configured',async()=>{const policy=testPolicy(),compiled=compileRolesPolicy(policy),call=goodCall(policy,compiled);call.membership=async()=>false;const result=await verifyPolicyReadback(policy,compiled,call,'latest');assert.equal(result.allOk,false);assert.equal(result.checks.find(c=>c.label==='Session membership')?.observed,'revoked');});
test('unavailable role membership never becomes active',async()=>{const policy=testPolicy(),compiled=compileRolesPolicy(policy),call=goodCall(policy,compiled);delete call.membership;assert.equal((await verifyPolicyReadback(policy,compiled,call,'latest')).allOk,false);});

test('readback keeps the installed window when recording on the following UTC day', async () => {
  const { moduleRecordContext } = await import('../db/active-modules.ts');
  const policy = testPolicy();
  policy.startsAt -= 86400;
  policy.expiresAt -= 86400;
  const compiled = compileRolesPolicy(policy);
  const call = goodCall(policy, compiled);
  const fresh = { ...policy, startsAt: policy.startsAt + 86400, expiresAt: policy.expiresAt + 86400 };
  assert.equal((await verifyPolicyReadback(fresh, compiled, call, 'latest')).allOk, false);
  const context = moduleRecordContext({ safe: SAFE, module: MODULE, mandateVersion: 4, verifiedAt: new Date(policy.startsAt * 1000).toISOString(), outputs: policy.outputs, startsAt: policy.startsAt, expiresAt: policy.expiresAt }, MODULE, policy.outputs);
  assert.equal((await verifyPolicyReadback({ ...fresh, ...context.window }, compiled, call, 'latest')).allOk, true);
});
