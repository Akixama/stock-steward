import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, keccak256, toHex, parseAbiParameters, type Hex } from 'viem';
import { compileRolesPolicy, type RolesPolicy } from './roles-permission.ts';
import { EXECUTION_CONTRACTS } from './autonomy.ts';
import { installedOutputs } from './installed-outputs.ts';
test('recovers the installed floor, proving the full scoped conditions', () => {
  const policy: RolesPolicy = { account: '0x1111111111111111111111111111111111111111', module: '0x2222222222222222222222222222222222222222', session: '0x3333333333333333333333333333333333333333', grantId: keccak256(toHex('grant')), routerCodeHash: keccak256(toHex('router')), startsAt: 1791590400, expiresAt: 1791763200, inputRaw: '10000000', dailyRaw: '50000000', totalRaw: '100000000', outputs: [{ token: '0x4444444444444444444444444444444444444444', fee: 3000, tickSpacing: 60, minimumOutputRaw: '12345' }] };
  const compiled = compileRolesPolicy(policy);
  const data = encodeAbiParameters(parseAbiParameters('bytes32,address,bytes4,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[],uint8'), [compiled.roleKey, EXECUTION_CONTRACTS.router, '0x3593564c', compiled.conditions, 0]);
  const topic = keccak256(toHex('ScopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)'));
  const logs = [{ data, topics: [topic] as Hex[] }];
  assert.deepEqual(installedOutputs({ ...policy, outputs: [{ ...policy.outputs[0], minimumOutputRaw: '99999' }] }, logs), policy.outputs);
  assert.throws(() => installedOutputs({ ...policy, inputRaw: '5000000' }, logs));
  assert.throws(() => installedOutputs(policy, []));
});
