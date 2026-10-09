import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,type Address,type Hex} from 'viem';
import {safeSetupPlan,safeSetupAbi,safeFactoryAbi,SAFE_CONTRACTS} from './safe-setup.ts';
test('wallet setup gives only the owner control and includes no payment or worker',()=>{
 const owner=('0x'+'1'.repeat(40)) as Address,nonce=('0x'+'a'.repeat(64)) as Hex,code=('0x'+'60'.repeat(100)) as Hex;
 const plan=safeSetupPlan(owner,nonce,code);
 const setup=decodeFunctionData({abi:safeSetupAbi,data:plan.initializer});
 const zero='0x0000000000000000000000000000000000000000';
 assert.deepEqual(setup.args,[[owner],1n,zero,'0x',zero,zero,0n,zero]);
 const creation=decodeFunctionData({abi:safeFactoryAbi,data:plan.call.data});
 assert.deepEqual(creation.args,[SAFE_CONTRACTS.singleton,plan.initializer,BigInt(nonce)]);
 assert.equal(plan.installationEnabled,false);assert.equal(plan.call.value,'0x0');
 assert.equal(safeSetupPlan(owner,nonce,code).account,plan.account);
 assert.notEqual(safeSetupPlan(('0x'+'2'.repeat(40)) as Address,nonce,code).account,plan.account);
 assert.throws(()=>safeSetupPlan(zero,nonce,code));assert.throws(()=>safeSetupPlan(owner,'0x',code));
});
