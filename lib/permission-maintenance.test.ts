import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { fundingRemainingValid, maintenanceEligibility, maintenanceEarlyProof, maintenanceReceiptProof, maintenanceTransaction, renewedPolicy, renewalVerified, revocationVerified, safeExecutionSuccessTopic } from './permission-maintenance.ts';
import { PERMIT2 } from './install-flow.ts';
import { MULTISEND } from './safe-setup.ts';
import { VENUE } from './chain-route.ts';
import { EXECUTION_CONTRACTS } from './autonomy.ts';
import { PERMISSION_WINDOW_SECONDS, permissionWindow, permissionTimeRemaining } from './permission-window.ts';
import type { RolesPolicy } from './roles-permission.ts';
test('permission countdown reflects UTC expiry and never goes negative',()=>{
  const start=Date.parse('2026-10-21T00:00:00Z');
  const expiry=Math.floor((start+2*86_400_000)/1000);
  assert.equal(permissionTimeRemaining(expiry,start),'2d remaining');
  assert.equal(permissionTimeRemaining(expiry,start+47*3_600_000),'1h remaining');
  assert.equal(permissionTimeRemaining(expiry,start+2*86_400_000),'Expired');
});

const owner='0xdc7f175bca1c29a77286a52c857e7fef12f3f662' as Address;
const safe='0x571223133777f85a738f79a61042ab16157d493d' as Address;
const moduleAddress='0x67c56b3715f6d1ef2d6db678660ac207b95e96c9' as Address;
const now=new Date('2026-10-20T01:00:00.000Z');
const oldWindow=permissionWindow(new Date('2026-10-18T12:00:00.000Z'));
const policy:RolesPolicy={account:safe,module:moduleAddress,session:owner,grantId:keccak256(toHex('renew-test')),
  routerCodeHash:keccak256(toHex('router-code')),...oldWindow,inputRaw:'5000000',dailyRaw:'20000000',totalRaw:'40000000',
  outputs:[{token:'0x1111111111111111111111111111111111111111',fee:3000,tickSpacing:60,minimumOutputRaw:'1'}]};

test('spent but bounded buy approvals remain valid; mismatched or enlarged approvals fail',()=>{
  const active={...policy,expiresAt:Math.floor(Date.parse('2026-10-22T00:00:00Z')/1000)};
  const clock=Date.parse('2026-10-21T13:00:00Z');
  const remaining={tokenRaw:35000000n,permitRaw:35000000n,permitExpiresAt:active.expiresAt};
  assert.equal(fundingRemainingValid(active,remaining,clock),true);
  assert.equal(fundingRemainingValid(active,{...remaining,permitRaw:30000000n},clock),false);
  assert.equal(fundingRemainingValid(active,{...remaining,tokenRaw:40000001n,permitRaw:40000001n},clock),false);
  assert.equal(fundingRemainingValid(active,{...remaining,tokenRaw:4000000n,permitRaw:4000000n},clock),false);
  assert.equal(fundingRemainingValid(active,{...remaining,permitExpiresAt:active.expiresAt+60},clock),false);
  assert.equal(fundingRemainingValid(active,remaining,active.expiresAt*1000-30000),false);
});

function unpack(data:Hex){
  const safeCall=decodeFunctionData({abi:parseAbi(['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)']),data});
  assert.equal(safeCall.args[0].toLowerCase(),MULTISEND.address.toLowerCase());
  assert.equal(safeCall.args[3],1);
  const multi=decodeFunctionData({abi:parseAbi(['function multiSend(bytes transactions)']),data:safeCall.args[2]});
  let bytes=multi.args[0].slice(2);
  const calls:{to:string;data:Hex}[]=[];
  while(bytes.length){
    assert.equal(bytes.slice(0,2),'00');
    const to=`0x${bytes.slice(2,42)}`;
    const size=Number(BigInt(`0x${bytes.slice(106,170)}`));
    const callData=`0x${bytes.slice(170,170+size*2)}` as Hex;
    calls.push({to,data:callData});bytes=bytes.slice(170+size*2);
  }
  return calls;
}

test('expired and soon-to-expire states are distinct; window stays two UTC days',()=>{
  const expiry=Date.parse('2026-10-20T00:00:00Z')/1000;
  assert.deepEqual(maintenanceEligibility(expiry,Date.parse('2026-10-19T14:00:00Z')),{state:'soon',mayRenew:false,notice:true});
  assert.deepEqual(maintenanceEligibility(expiry,Date.parse('2026-10-20T00:00:00Z')),{state:'expired',mayRenew:true,notice:true});
  assert.equal(permissionWindow(now).expiresAt-permissionWindow(now).startsAt,PERMISSION_WINDOW_SECONDS);
  assert.throws(()=>renewedPolicy({...policy,expiresAt:expiry+1},new Date(expiry*1000)),/Wait until/);
});

test('renew reuses the exact Safe, module, role and cap; success requires all readbacks',(t)=>{
  // Keep the fixture inside its Oct 20–22 approval window regardless of when
  // the suite runs. The production verifier still uses the real clock.
  t.mock.method(Date,'now',()=>Date.parse('2026-10-21T12:00:00Z'));
  const result=maintenanceTransaction('renew',owner,policy,now);
  assert.equal(result.transaction.to,safe);
  assert.equal(result.policy.account,safe);
  assert.equal(result.policy.module,moduleAddress);
  assert.equal(result.policy.grantId,policy.grantId);
  assert.equal(result.policy.totalRaw,policy.totalRaw);
  assert.equal(result.policy.expiresAt,Date.parse('2026-10-22T00:00:00Z')/1000);
  const calls=unpack(result.transaction.data);
  assert.equal(calls.length,7);
  assert.ok([...calls.slice(0,4),calls[6]].every(call=>call.to.toLowerCase()===moduleAddress.toLowerCase()));
  const tokenApproval=decodeFunctionData({abi:parseAbi(['function approve(address,uint256)']),data:calls[4].data});
  assert.equal(calls[4].to.toLowerCase(),VENUE.settlement.toLowerCase());
  assert.equal(tokenApproval.args[0].toLowerCase(),PERMIT2.toLowerCase());
  assert.equal(tokenApproval.args[1],BigInt(result.policy.totalRaw));
  const permitApproval=decodeFunctionData({abi:parseAbi(['function approve(address,address,uint160,uint48)']),data:calls[5].data});
  assert.equal(calls[5].to.toLowerCase(),PERMIT2.toLowerCase());
  assert.equal(permitApproval.args[0].toLowerCase(),VENUE.settlement.toLowerCase());
  assert.equal(permitApproval.args[1].toLowerCase(),EXECUTION_CONTRACTS.router.toLowerCase());
  assert.equal(permitApproval.args[2],BigInt(result.policy.totalRaw));
  assert.equal(permitApproval.args[3],result.policy.expiresAt);
  const funding={tokenRaw:40000000n,permitRaw:40000000n,permitExpiresAt:result.policy.expiresAt};
  const passing=Array.from({length:7},()=>({ok:true}));
  assert.equal(renewalVerified(result.policy,funding,passing),true);
  assert.equal(renewalVerified(result.policy,{...funding,tokenRaw:40000001n},passing),false);
  assert.equal(renewalVerified(result.policy,{...funding,permitRaw:40000001n},passing),false);
  assert.equal(renewalVerified(result.policy,{...funding,permitExpiresAt:policy.expiresAt},passing),false);
  assert.equal(renewalVerified(result.policy,funding,passing.map((check,index)=>index===3?{ok:false}:check)),false);
  assert.equal(renewalVerified(result.policy,funding,passing.slice(1)),false);
});

test('revoke batches role removal and BOTH zero approvals; proof requires both zero',()=>{
  const result=maintenanceTransaction('revoke',owner,policy,now);
  const calls=unpack(result.transaction.data);
  assert.equal(calls.length,3);
  assert.equal(calls[0].to.toLowerCase(),moduleAddress.toLowerCase());
  const role=decodeFunctionData({abi:parseAbi(['function assignRoles(address,bytes32[],bool[])']),data:calls[0].data});
  assert.deepEqual(role.args[2],[false]);
  assert.equal(calls[1].to.toLowerCase(),VENUE.settlement.toLowerCase());
  const token=decodeFunctionData({abi:parseAbi(['function approve(address,uint256)']),data:calls[1].data});
  assert.equal(token.args[0].toLowerCase(),PERMIT2.toLowerCase());assert.equal(token.args[1],0n);
  assert.equal(calls[2].to.toLowerCase(),PERMIT2.toLowerCase());
  const permit=decodeFunctionData({abi:parseAbi(['function approve(address,address,uint160,uint48)']),data:calls[2].data});
  assert.equal(permit.args[0].toLowerCase(),VENUE.settlement.toLowerCase());
  assert.equal(permit.args[1].toLowerCase(),EXECUTION_CONTRACTS.router.toLowerCase());
  assert.equal(permit.args[2],0n);assert.equal(permit.args[3],0);
  assert.equal(revocationVerified(false,{tokenRaw:0n,permitRaw:0n,permitExpiresAt:0}),true);
  assert.equal(revocationVerified(false,{tokenRaw:1n,permitRaw:0n,permitExpiresAt:0}),false);
  assert.equal(revocationVerified(false,{tokenRaw:0n,permitRaw:1n,permitExpiresAt:0}),false);
  assert.equal(revocationVerified(true,{tokenRaw:0n,permitRaw:0n,permitExpiresAt:0}),false);
});

test('renewal receipt stays unresolved until finalized exact Safe success and readbacks',()=>{
  const result=maintenanceTransaction('renew',owner,policy,now);
  const expected={ownerAddress:owner,safe,transaction:result.transaction};
  const tx={from:owner,to:safe,input:result.transaction.data,value:'0x0',chainId:'0x1237'};
  const receipt={status:'0x1',blockNumber:'0x10',logs:[{address:safe,topics:[safeExecutionSuccessTopic]}]};
  assert.equal(maintenanceReceiptProof(expected,null,tx,'0x20'),'unknown');
  assert.equal(maintenanceReceiptProof(expected,receipt,tx,'0x0f'),'unknown');
  assert.equal(maintenanceReceiptProof(expected,receipt,{...tx,input:'0xabcd'},'0x20'),'unknown');
  assert.equal(maintenanceReceiptProof(expected,{...receipt,logs:[]},tx,'0x20'),'unknown');
  assert.equal(maintenanceReceiptProof(expected,{...receipt,status:'0x0'},tx,'0x20'),'reverted');
  assert.equal(maintenanceReceiptProof(expected,receipt,tx,'0x20'),'success');
});
test('renewal early status requires blocks, canonical inclusion and exact Safe result',()=>{
  const result=maintenanceTransaction('renew',owner,policy,now);
  const expected={ownerAddress:owner,safe,transaction:result.transaction};
  const tx={from:owner,to:safe,input:result.transaction.data,value:'0x0',chainId:'0x1237'};
  const receipt={status:'0x1',blockNumber:'0x10',blockHash:'0x'+'a'.repeat(64),logs:[{address:safe,topics:[safeExecutionSuccessTopic]}]};
  assert.equal(maintenanceEarlyProof(expected,receipt,tx,receipt.blockHash,'0x11',4),'unknown');
  assert.equal(maintenanceEarlyProof(expected,receipt,tx,receipt.blockHash,'0x13',4),'confirmed');
  assert.equal(maintenanceEarlyProof(expected,{...receipt,status:'0x0'},tx,receipt.blockHash,'0x13',4),'reverted');
  assert.equal(maintenanceEarlyProof(expected,receipt,tx,'0x'+'b'.repeat(64),'0x13',4),'reorged');
  assert.equal(maintenanceEarlyProof(expected,receipt,{...tx,input:'0xabcd'},receipt.blockHash,'0x13',4),'unknown');
});
