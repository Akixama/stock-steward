import test from 'node:test';
import assert from 'node:assert/strict';
import {installationConsents,verifyFeeRecord,verifyStartRecord,bindsRule} from './installation-consent.ts';
const owner='0x'+'a'.repeat(40),hash=('0x'+'b'.repeat(64)) as `0x${string}`,policyHash='0x'+'c'.repeat(64),digest='0x'+'d'.repeat(64);
const now=Date.parse('2026-10-24T12:00:00Z');
const grant=(over:Partial<{state:string;grant_transaction:string|null}>={})=>({id:'g1',state:'verified',grant_transaction:hash,lease_json:JSON.stringify({owner,policyHash}),policy_json:JSON.stringify({expiresAt:now/1000+7*86400}),...over});

test('a verified installation becomes the fee and start approval for that exact grant',async()=>{
 const c=installationConsents(grant(),'https://stocksteward.app',50,digest,new Date(now));
 assert.equal(c.signature,hash);assert.equal(c.fee.maxFeeCents,50);assert.equal(c.start.ruleDigest,null);
 assert.equal(await verifyFeeRecord(c.fee,c.signature,grant(),now+1000),true);
 assert.equal(await verifyStartRecord(c.start,c.signature,grant(),now+1000),true);
 assert.equal(bindsRule(c.start),false);
});
test('it never arms a draft, a different transaction, another grant or an expired permission',async()=>{
 assert.throws(()=>installationConsents(grant({state:'draft'}),'https://x.y',50,digest));
 assert.throws(()=>installationConsents(grant(),'https://x.y',0,digest));
 assert.throws(()=>installationConsents(grant(),'https://x.y',1001,digest));
 const c=installationConsents(grant(),'https://stocksteward.app',50,digest,new Date(now));
 const other=('0x'+'e'.repeat(64)) as `0x${string}`;
 assert.equal(await verifyFeeRecord(c.fee,other,grant(),now+1000),false,'spoofed hash');
 assert.equal(await verifyStartRecord(c.start,c.signature,grant({state:'paused'}),now+1000),false,'paused grant');
 assert.equal(await verifyStartRecord(c.start,c.signature,grant({grant_transaction:other}),now+1000),false,'different install');
 assert.equal(await verifyFeeRecord({...c.fee,grantId:'g2'},c.signature,grant(),now+1000),false,'other grant');
 assert.equal(await verifyStartRecord(c.start,c.signature,grant(),now+8*86400*1000),false,'after expiry');
});
