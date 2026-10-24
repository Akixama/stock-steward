import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeErrorResult,parseAbi,type Hex} from 'viem';
import {refusalReason,classifyReply,stewardChecks} from './stress-test.ts';
const errors=parseAbi(['error NoMembership()','error ConditionViolation(uint8 status,bytes32 info)']);
const violation=(status:number)=>encodeErrorResult({abi:errors,errorName:'ConditionViolation',args:[status,('0x'+'0'.repeat(64)) as Hex]});

test('permission errors become plain reasons',()=>{
 assert.equal(refusalReason(violation(2)),'that address is not on the allowed list');
 assert.equal(refusalReason(violation(9)),'an amount is above what is allowed');
 assert.equal(refusalReason(encodeErrorResult({abi:errors,errorName:'NoMembership'})),'the key has no permission at all');
 assert.equal(refusalReason(undefined),'the permission refused it');
});

test('a revert is a pass and a success is a loud failure',()=>{
 assert.deepEqual(classifyReply({error:{data:violation(2)}}),{refused:true,why:'Refused: that address is not on the allowed list.'});
 assert.equal(classifyReply({result:('0x'+'0'.repeat(63)+'1') as Hex}).refused,false);
});

test('Steward refuses oversize, off-list and over-daily buys before any wallet sees them',()=>{
 const rows=stewardChecks({allowedSymbols:['AAPL'],maxOrderCents:1000,maxDailyBuyCents:5000,version:3},'TSLA');
 assert.equal(rows.length,3);
 assert.ok(rows.every(r=>r.refused));
 assert.match(rows[1].why,/TSLA is not in your Limits/);
});
