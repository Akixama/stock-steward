import test from 'node:test';import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';import {parseTransaction,type Hex} from 'viem';
import {signBoundSessionTransaction} from './autonomous-session.ts';
import {bindPolicyLease} from './policy-lease.ts';import type {RolesPolicy} from './roles-permission.ts';
import {poolIdentity,VENUE,type RouteEvidence} from './chain-route.ts';
const key=('0x'+'1'.padStart(64,'0')) as Hex;
const session=privateKeyToAccount(key).address;
const account=('0x'+'a'.repeat(40)) as Hex,token=('0x'+'3'.repeat(40)) as Hex;
const now=Date.parse('2026-10-11T12:00:00Z');
function fixture(){
 const policy:RolesPolicy={account,module:('0x'+'8'.repeat(40)) as Hex,session,grantId:('0x'+'1'.repeat(64)) as Hex,routerCodeHash:('0x'+'2'.repeat(64)) as Hex,startsAt:1791676800,expiresAt:1791763200,inputRaw:'1000000',dailyRaw:'2000000',totalRaw:'3000000',outputs:[{token,fee:3000,tickSpacing:60,minimumOutputRaw:'123'}]};
 const snapshot={owner:'0x'+'6'.repeat(40),version:1,policyJson:'{"maxOrderCents":100}'};
 const lease=bindPolicyLease(snapshot,{address:session,ciphertextRef:'fixture'},policy,new Date(now).toISOString());
 const route={id:'isolated-fixture',chainId:4663,address:account,settlement:VENUE.settlement,token,inputRaw:'1000000',minimumOutputRaw:'123',best:{state:'quoted',outputRaw:'150',fee:3000,tickSpacing:60,poolId:poolIdentity(token,3000,60).poolId},blockHash:'0x'+'b'.repeat(64),observedAt:new Date(now).toISOString(),blockAt:new Date(now).toISOString(),expiresAt:new Date(now+20000).toISOString()} as RouteEvidence;
 const fees={nonce:0,gas:200000n,maxFeePerGas:100000000n,maxPriorityFeePerGas:0n,maximumGasCostWei:20000000000000n};return {policy,snapshot,lease,route,fees};
}
test('offline session signs only the exact zero-value Roles envelope on Robinhood Chain',async()=>{const f=fixture(),signed=await signBoundSessionTransaction(key,f.route,1,f.policy,f.lease,f.snapshot,f.fees,now),tx=parseTransaction(signed.raw);assert.equal(tx.chainId,4663);assert.equal(tx.to?.toLowerCase(),f.policy.module.toLowerCase());assert.equal(tx.value??0n,0n);assert.equal(signed.session,session.toLowerCase());assert.equal(signed.nonce,0);});
test('wrong session key, changed grant, expired quote and excessive fees refuse offline signing',async()=>{const f=fixture();await assert.rejects(signBoundSessionTransaction(('0x'+'2'.padStart(64,'0')) as Hex,f.route,1,f.policy,f.lease,f.snapshot,f.fees,now),/matching session/);await assert.rejects(signBoundSessionTransaction(key,f.route,1,f.policy,{...f.lease,state:'revoked'},f.snapshot,f.fees,now),/grant or mandate/);await assert.rejects(signBoundSessionTransaction(key,f.route,1,f.policy,f.lease,f.snapshot,f.fees,now+20001),/expired/);await assert.rejects(signBoundSessionTransaction(key,f.route,1,f.policy,f.lease,f.snapshot,{...f.fees,maximumGasCostWei:1n},now),/fees/);});
