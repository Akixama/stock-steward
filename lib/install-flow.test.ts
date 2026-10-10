import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { buildInstall, encodeBatch, installSalts, installationReadChecks, revocationStep, type InstallPolicyBase } from './install-flow.ts';
import { MULTISEND, SAFE_CONTRACTS, safeFactoryAbi, safeSetupPlan } from './safe-setup.ts';
import { ROLES_CONTRACTS, rolesFactoryAbi, compileRolesPolicy } from './roles-permission.ts';

const owner = '0xdc7f175bca1c29a77286a52c857e7fef12f3f662' as Address;
const proxyCreationCode = ('0x' + 'ab'.repeat(120)) as Hex;
const routerCodeHash = keccak256(toHex('stock-steward-test-router'));
const now = 1800000000000;
const startsAt = Math.floor(now / 1000 / 86400) * 86400;
const policyBase: InstallPolicyBase = {
  session: owner,
  grantId: keccak256(toHex('grant-1')),
  routerCodeHash,
  startsAt,
  expiresAt: startsAt + 2 * 86400,
  inputRaw: '5000000', dailyRaw: '20000000', totalRaw: '40000000',
  outputs: [
    { token: '0x1111111111111111111111111111111111111111', fee: 3000, tickSpacing: 60, minimumOutputRaw: '1' },
  ],
};

test('salts are deterministic per owner and version, distinct between the two deployments', () => {
  const a = installSalts(owner, 1);
  const b = installSalts(owner, 1);
  const c = installSalts(owner, 2);
  assert.deepEqual(a, b);
  assert.notEqual(a.safeSalt, a.moduleSalt);
  assert.notEqual(a.safeSalt, c.safeSalt);
  assert.throws(() => installSalts('bad', 1));
});

test('phase A is exactly the factory creations, fully precomputed', () => {
  const build = buildInstall({ owner, policyVersion: 1, policyBase, proxyCreationCode });
  assert.equal(build.stepsA.length, 2);
  assert.equal(build.stepsA[0].to, SAFE_CONTRACTS.factory);
  assert.equal(build.stepsA[1].to, ROLES_CONTRACTS.factory);
  assert.equal(decodeFunctionData({ abi: safeFactoryAbi, data: build.stepsA[0].data }).functionName, 'createProxyWithNonce');
  assert.equal(decodeFunctionData({ abi: rolesFactoryAbi, data: build.stepsA[1].data }).functionName, 'deployModule');
  // The predicted Safe matches the standalone setup plan for the same salt.
  const { safeSalt } = installSalts(owner, 1);
  const standalone = safeSetupPlan(owner, safeSalt, proxyCreationCode);
  assert.equal(build.safe.toLowerCase(), standalone.account.toLowerCase());
});

test('phase one refuses to grant the role to anyone but the owner wallet', () => {
  assert.throws(() => buildInstall({
    owner, policyVersion: 1, proxyCreationCode,
    policyBase: { ...policyBase, session: '0x2222222222222222222222222222222222222222' as Address },
  }), /owner wallet only/);
});

test('phase B wraps six owner calls on the Safe and compiles a live-valid policy', () => {
  const build = buildInstall({ owner, policyVersion: 1, policyBase, proxyCreationCode });
  const module = '0x3333333333333333333333333333333333333333' as Address;
  const { policy, steps, compiled } = build.phaseB(module);
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map(s => s.key),
    ['enable_module', 'scope_target', 'scope_function', 'daily_quota', 'total_quota', 'grant_role']);
  for (const step of steps) {
    assert.equal(step.to.toLowerCase(), build.safe.toLowerCase());
    // execTransaction selector — every owner action travels through the Safe.
    assert.ok(step.data.startsWith('0x6a761202'), `${step.key} must be a Safe execTransaction`);
  }
  assert.equal(compiled.calls.length, 5);
  assert.ok(compiled.roleKey.startsWith('0x'));
  assert.equal(policy.session, owner);
  // The produced policy round-trips through the real compiler (its caps included).
  assert.deepEqual(compileRolesPolicy(policy).roleKey, compiled.roleKey);
});

test('the compiler caps still bind the install: four outputs are refused', () => {
  const build = buildInstall({ owner, policyVersion: 1, proxyCreationCode,
    policyBase: { ...policyBase, outputs: [
      ...policyBase.outputs,
      { token: '0x2222222222222222222222222222222222222222', fee: 500, tickSpacing: 10, minimumOutputRaw: '1' },
      { token: '0x4444444444444444444444444444444444444444', fee: 500, tickSpacing: 10, minimumOutputRaw: '1' },
      { token: '0x5555555555555555555555555555555555555555', fee: 500, tickSpacing: 10, minimumOutputRaw: '1' },
    ] } });
  assert.throws(() => build.phaseB('0x3333333333333333333333333333333333333333' as Address));
});

const execAbi = parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)']);
const multiAbi = parseAbi(['function multiSend(bytes transactions)']);

function unpackBatch(batchedData: Hex): { op: number; to: string; data: string }[] {
  const outer = decodeFunctionData({ abi: execAbi, data: batchedData });
  const [batchTo, , batchData, operation] = outer.args as unknown as [string, bigint, Hex, number];
  assert.equal(batchTo.toLowerCase(), MULTISEND.address.toLowerCase());
  assert.equal(operation, 1);
  const inner = decodeFunctionData({ abi: multiAbi, data: batchData });
  assert.equal(inner.functionName, 'multiSend');
  const blob = (inner.args[0] as string).slice(2);
  const entries: { op: number; to: string; data: string }[] = [];
  let at = 0;
  while (at < blob.length) {
    const op = parseInt(blob.slice(at, at + 2), 16); at += 2;
    const to = '0x' + blob.slice(at, at + 40); at += 40;
    const value = BigInt('0x' + blob.slice(at, at + 64)); at += 64;
    const len = parseInt(blob.slice(at, at + 64), 16); at += 64;
    const data = '0x' + blob.slice(at, at + len * 2); at += len * 2;
    assert.equal(value, 0n);
    entries.push({ op, to, data });
  }
  return entries;
}

function innerCallsOf(steps: { data: Hex }[]): { to: string; data: string }[] {
  return steps.map((step) => {
    const decoded = decodeFunctionData({ abi: execAbi, data: step.data });
    const [to, , data, operation] = decoded.args as unknown as [string, bigint, Hex, number];
    assert.equal(operation, 0);
    return { to: to.toLowerCase(), data: data.toLowerCase() };
  });
}

test('phase B packs every call into one audited batch transaction', () => {
  const build = buildInstall({ owner, policyVersion: 1, policyBase, proxyCreationCode });
  const module = '0x3333333333333333333333333333333333333333' as Address;
  const { steps, batched } = build.phaseB(module);
  assert.equal(batched.key, 'batch_all');
  assert.equal(batched.to.toLowerCase(), build.safe.toLowerCase());
  assert.ok(batched.data.startsWith('0x6a761202'));
  const entries = unpackBatch(batched.data);
  assert.equal(entries.length, 6);
  assert.ok(entries.every((entry) => entry.op === 0));
  // The batch carries exactly the step-by-step calls, in the same order.
  assert.deepEqual(
    entries.map((entry) => ({ to: entry.to.toLowerCase(), data: entry.data.toLowerCase() })),
    innerCallsOf(steps));
  // Deterministic: the same inputs always pack the same transaction.
  assert.equal(build.phaseB(module).batched.data, batched.data);
});

test('a resumed phase B leaves the enable call out of both paths', () => {
  const build = buildInstall({ owner, policyVersion: 1, policyBase, proxyCreationCode });
  const module = '0x3333333333333333333333333333333333333333' as Address;
  const { steps, batched } = build.phaseB(module, true);
  assert.deepEqual(steps.map((step) => step.key),
    ['scope_target', 'scope_function', 'daily_quota', 'total_quota', 'grant_role']);
  const entries = unpackBatch(batched.data);
  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) => ({ to: entry.to.toLowerCase(), data: entry.data.toLowerCase() })),
    innerCallsOf(steps));
});

test('batch packing refuses malformed calls', () => {
  assert.throws(() => encodeBatch([{ to: 'bad' as Address, data: '0x1234' as Hex }]));
  assert.throws(() => encodeBatch([{ to: owner, data: '0x123' as Hex }]));
});

test('readback checks cover admin control, membership and both quotas', () => {
  const build = buildInstall({ owner, policyVersion: 1, policyBase, proxyCreationCode });
  const module = '0x3333333333333333333333333333333333333333' as Address;
  const { policy, compiled } = build.phaseB(module);
  const checks = installationReadChecks({ session: owner, compiled, policy });
  assert.equal(checks.length, 6);
  assert.equal(checks[3].expect, 'true');
  assert.match(checks[4].expect, /^4 buys per 86400s$/);   // $20 daily / $5 per buy
  assert.match(checks[5].expect, /^8 buys total$/);        // two-day ceiling / $5 per buy
  const revoke = revocationStep(compiled);
  assert.equal(revoke.to.toLowerCase(), module.toLowerCase());
});
