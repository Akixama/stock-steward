import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex, type Address } from 'viem';
import { issueMaintenanceReview, verifyMaintenanceReview } from './maintenance-review-token.ts';
import { maintenanceTransaction } from './permission-maintenance.ts';
import { permissionWindow } from './permission-window.ts';
import type { RolesPolicy } from './roles-permission.ts';

const clock=Date.parse('2026-10-22T12:00:00Z');
const owner='0xdc7f175bca1c29a77286a52c857e7fef12f3f662' as Address;
const safe='0x571223133777f85a738f79a61042ab16157d493d' as Address;
const moduleAddress='0x67c56b3715f6d1ef2d6db678660ac207b95e96c9' as Address;
const oldWindow=permissionWindow(new Date('2026-10-20T12:00:00Z'));
const policy:RolesPolicy={account:safe,module:moduleAddress,session:owner,grantId:keccak256(toHex('review-test')),
  routerCodeHash:keccak256(toHex('router')), ...oldWindow,inputRaw:'5000000',dailyRaw:'20000000',totalRaw:'40000000',
  outputs:[{token:'0x1111111111111111111111111111111111111111',fee:3000,tickSpacing:60,minimumOutputRaw:'100'}]};

test('a changed fee estimate does not block the exact reviewed calls, cap, wallet or expiry',async()=>{
  const reviewed=maintenanceTransaction('renew',owner,policy,new Date(clock));
  const digest=keccak256(reviewed.transaction.data);
  const claims={owner:'user-1',kind:'renew' as const,digest,safe,module:moduleAddress,
    startsAt:reviewed.policy.startsAt,issuedAt:clock,outputs:reviewed.policy.outputs};
  const token=await issueMaintenanceReview(claims,'test secret');
  // Two different gas estimates are display-only. Neither enters the signed
  // review token or the transaction calldata.
  const previewFee='0.0001',confirmFee='0.0002';
  assert.notEqual(previewFee,confirmFee);
  const verified=await verifyMaintenanceReview(token,'test secret',
    {owner:'user-1',kind:'renew',digest,safe,module:moduleAddress},clock+30_000);
  const prepared=maintenanceTransaction('renew',owner,{...policy,outputs:verified.outputs as RolesPolicy['outputs']},
    new Date(verified.startsAt*1000));
  assert.equal(prepared.transaction.data,reviewed.transaction.data);
  assert.equal(prepared.amountRaw,reviewed.amountRaw);
  assert.equal(prepared.expiresAt,reviewed.expiresAt);
  assert.equal(prepared.transaction.to,safe);
  assert.deepEqual(prepared.calls,reviewed.calls);
});

test('changed wallet, amount, expiry, spender or call data cannot reuse a review',async()=>{
  const reviewed=maintenanceTransaction('renew',owner,policy,new Date(clock));
  const digest=keccak256(reviewed.transaction.data);
  const claims={owner:'user-1',kind:'renew' as const,digest,safe,module:moduleAddress,
    startsAt:reviewed.policy.startsAt,issuedAt:clock,outputs:reviewed.policy.outputs};
  const token=await issueMaintenanceReview(claims,'test secret');
  const expected={owner:'user-1',kind:'renew' as const,digest,safe,module:moduleAddress};
  await assert.rejects(verifyMaintenanceReview(token,'test secret',{...expected,safe:owner},clock));
  await assert.rejects(verifyMaintenanceReview(token,'test secret',{...expected,digest:keccak256(toHex('different calls'))},clock));
  await assert.rejects(verifyMaintenanceReview(token,'test secret',expected,clock+6*60_000));
  const changedCap=maintenanceTransaction('renew',owner,{...policy,totalRaw:'40000001'},new Date(clock));
  assert.notEqual(keccak256(changedCap.transaction.data),digest);
  const changedSpenderToken=token.replace(/.$/,'x');
  await assert.rejects(verifyMaintenanceReview(changedSpenderToken,'test secret',expected,clock));
  const changedQuote=maintenanceTransaction('renew',owner,{...policy,outputs:[{...policy.outputs[0],minimumOutputRaw:'101'}]},new Date(clock));
  assert.notEqual(keccak256(changedQuote.transaction.data),digest);
});
