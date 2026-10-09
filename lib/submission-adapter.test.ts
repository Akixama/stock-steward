import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {submitOnce,type SubmissionRequest} from './submission-adapter.ts';
import {routerCandidate} from './router-candidate.ts';import {poolIdentity,VENUE,type RouteEvidence} from './chain-route.ts';
import type {ExecutionEvidence} from './execution-guard.ts';import type {AccountingEvidence} from './execution-accounting.ts';
import {bindPolicyLease,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';import type {RolesPolicy} from './roles-permission.ts';
import {getAttempt} from '../db/execution-attempts.ts';import {saveSessionSigner,loadSessionSignerMaterial} from '../db/session-signers.ts';
import type {Hex} from 'viem';
function ledger(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE autonomy_spends(owner_ref TEXT,address TEXT,execution_day TEXT,intent_id TEXT,amount_cents INTEGER,state TEXT,PRIMARY KEY(owner_ref,address,intent_id));');
 sql.exec(readFileSync(new URL('../drizzle/0010_flimsy_paibok.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../drizzle/0015_even_captain_marvel.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let values:(string|number|null)[]=[];const statement={bind(...args:(string|number|null)[]){values=args;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},async first(){return sql.prepare(query).get(...values)??null;}};return statement;},async batch(statements:{run():Promise<unknown>}[]){sql.exec('BEGIN');try{const output=[];for(const s of statements)output.push(await s.run());sql.exec('COMMIT');return output;}catch(error){sql.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
 return {db,sql};
}
const KEY=btoa('k'.repeat(32)),OTHER=btoa('x'.repeat(32));
const nowMs=Date.parse('2026-09-27T12:00:00Z'),now=new Date(nowMs),stamp=new Date(nowMs).toISOString(),expiry=new Date(nowMs+20000).toISOString();
const addr=(c:string)=>('0x'+c.repeat(40)) as Hex;
const hex64=(c:string)=>('0x'+c.repeat(64)) as Hex;
function fixture(){
 const address=addr('a'),token=addr('3'),blockHash=hex64('b');
 const route={id:'fixture-only',chainId:4663,address,settlement:VENUE.settlement,token,inputRaw:'1000000',minimumOutputRaw:'123',best:{state:'quoted',outputRaw:'150',fee:3000,tickSpacing:60,poolId:poolIdentity(token,3000,60).poolId},blockHash,observedAt:stamp,blockAt:stamp,expiresAt:expiry} as RouteEvidence;
 const candidate=routerCandidate(route,1);
 const evidence:ExecutionEvidence={route,intentDigest:candidate.intentDigest,owner:address,mandateVersion:1,observedMandateVersion:1,paused:false,ownershipVerified:true,eligibilityVerified:true,permission:{installed:true,expiresAt:expiry,revoked:false,tokenCaps:true,recipients:true,outputTokens:true,calldata:true,revocationTested:true,implementationVerified:true},fundsVerified:true,dailyReserved:true,concentrationVerified:true,simulation:{success:true,account:address,routeId:route.id,blockHash,intentDigest:candidate.intentDigest},fees:{complete:true,withinCap:true},approval:{mode:'approval',intentDigest:candidate.intentDigest,routeId:route.id,mandateVersion:1,expiresAt:expiry}};
 const accounting:AccountingEvidence={address,chainId:4663,blockHash,observedAt:stamp,inventoryComplete:true,externalActivityReconciled:true,priceSourcesVerified:true,settlement:{balanceRaw:'2000000',reservedRaw:'0',decimals:6,upperMicroUsdPerToken:'1000000',priceAt:stamp,source:'test-fixture-only'},portfolio:{totalMicroUsd:'100000000',positionMicroUsd:'1000000',maximumLossMicroUsd:'1000000'},daily:{day:'2026-09-27',filledCents:0,pendingCents:0}};
 const mandateSnapshot:MandateSnapshot={owner:'0x'+'6'.repeat(40),version:1,policyJson:'{"maxOrderCents":150}'};
 const signerAddress=addr('7');
 const policy:RolesPolicy={account:address,module:addr('8'),session:signerAddress,grantId:hex64('1'),routerCodeHash:hex64('2'),startsAt:Date.parse('2026-09-27T00:00:00Z')/1000,expiresAt:Date.parse('2026-09-28T00:00:00Z')/1000,inputRaw:'1000000',dailyRaw:'2000000',totalRaw:'3000000',outputs:[{token:addr('a'),fee:3000,tickSpacing:60,minimumOutputRaw:'123'}]};
 const lease:PolicyLease=bindPolicyLease(mandateSnapshot,{address:signerAddress,ciphertextRef:'sessions/1/x'},policy,new Date(nowMs).toISOString());
 const limits={maxOrderCents:150,maxDailyCents:250,maxPositionBps:2000};
 return {address,token,blockHash,candidate,evidence,accounting,mandateSnapshot,signerAddress,policy,lease,limits};
}
function request(over:Partial<SubmissionRequest>={},calls?:string[]):SubmissionRequest{
 const f=fixture();
 return {submissionSwitchOn:true,paused:false,owner:'alice',mandateSnapshot:f.mandateSnapshot,evidence:f.evidence,accounting:f.accounting,limits:f.limits,candidate:f.candidate,lease:f.lease,existingLeases:[],
  db:null as unknown as D1Database,
  signer:async()=>{calls?.push('signer');return hex64('9');},
  loadMaterial:async(_owner,address)=>{return address.toLowerCase()===f.signerAddress.toLowerCase()?'material':null;},
  now,...over} as SubmissionRequest;
}
test('the happy path signs exactly once and the ledger refuses every retry',async()=>{
 const {db,sql}=ledger();try{
  const calls:string[]=[];const first=await submitOnce(request({db},calls));
  assert.equal(first.outcome,'submitted');assert.equal(first.executionEnabled,false);assert.equal((first as{autonomousExecution?:boolean}).autonomousExecution,false);
  assert.equal(first.outcome==='submitted'&&first.transactionHash,'0x'+'9'.repeat(64));
  assert.equal(calls.filter(c=>c==='signer').length,1);
  const attempt=await getAttempt(db,'alice',fixture().candidate.intentDigest);assert.equal(attempt?.state,'submitted');
  const retry=await submitOnce(request({db},calls));
  assert.equal(retry.outcome,'blocked');assert.match((retry as{reasons:string[]}).reasons.join(' '),/already attempted/);
  assert.equal(calls.filter(c=>c==='signer').length,1);
 }finally{sql.close();}
});
test('the switch, pause fence and exact approval gate block before any signing',async()=>{
 for(const over of [{submissionSwitchOn:false},{paused:true},{evidence:{...fixture().evidence,approval:{mode:'automatic',intentDigest:null,routeId:null,mandateVersion:null,expiresAt:null}} as ExecutionEvidence}]){
  const {db,sql}=ledger();try{const calls:string[]=[];const result=await submitOnce(request({...over,db},calls));
   assert.equal(result.outcome,'blocked');assert.equal(calls.length,0);
  }finally{sql.close();}
 }
});
test('an uncertain signer outcome becomes durable unknown and is never retried',async()=>{
 const {db,sql}=ledger();try{
  const calls:string[]=[];const fail=request({db,signer:async()=>{calls.push('signer');throw Error('broadcast outcome uncertain');}},calls);
  const result=await submitOnce(fail);
  assert.equal(result.outcome,'unknown');assert.match((result as{why:string}).why,/never be retried/);
  assert.equal((await getAttempt(db,'alice',fixture().candidate.intentDigest))?.state,'unknown');
  const retry=await submitOnce(request({db,signer:async()=>{calls.push('signer');return hex64('9');}},calls));
  assert.equal(retry.outcome,'blocked');assert.equal(calls.filter(c=>c==='signer').length,1);
 }finally{sql.close();}
});
test('a malformed signer hash is unknown, not a submission',async()=>{
 const {db,sql}=ledger();try{const result=await submitOnce(request({db,signer:async()=>'not-a-hash'}));
  assert.equal(result.outcome,'unknown');assert.equal((await getAttempt(db,'alice',fixture().candidate.intentDigest))?.state,'unknown');
 }finally{sql.close();}
});
test('mandate drift, revoked or coactive leases block before signing',async()=>{
 const f=fixture();
 for(const over of [{mandateSnapshot:{...f.mandateSnapshot,policyJson:'{"maxOrderCents":999}'}},{lease:{...f.lease,state:'revoked'} as PolicyLease},{existingLeases:[{...f.lease,grantId:hex64('7')}]}]){
  const {db,sql}=ledger();try{const calls:string[]=[];const result=await submitOnce(request({...over,db},calls));
   assert.equal(result.outcome,'blocked');assert.equal(calls.length,0);
  }finally{sql.close();}
 }
});
test('failed review, missing signer material and wrong-session material block',async()=>{
 for(const over of [{accounting:{...fixture().accounting,inventoryComplete:false}},{loadMaterial:async()=>null},{loadMaterial:async(o:string,a:string)=>a.toLowerCase()===fixture().signerAddress.toLowerCase()?null:'material'}]){
  const {db,sql}=ledger();try{const calls:string[]=[];const result=await submitOnce(request({...over,db},calls));
   assert.equal(result.outcome,'blocked');assert.equal(calls.filter(c=>c==='signer').length,0);
  }finally{sql.close();}
 }
});
test('real encrypted signer material round-trips only with the right key and never leaks',async()=>{
 const {db,sql}=ledger();try{
  const saved=await saveSessionSigner(db,'alice',fixture().signerAddress,'secret-material',KEY);
  assert.equal(saved.ciphertextRef,'session_signers/alice/'+fixture().signerAddress.toLowerCase());
  assert.equal(await loadSessionSignerMaterial(db,'alice',fixture().signerAddress,KEY),'secret-material');
  assert.equal(await loadSessionSignerMaterial(db,'alice',fixture().signerAddress,OTHER),null);
  assert.equal(await loadSessionSignerMaterial(db,'bob',fixture().signerAddress,KEY),null);
  const row=sql.prepare('SELECT signer_ciphertext,signer_iv FROM session_signers').get() as {signer_ciphertext:string;signer_iv:string};
  assert.ok(!Buffer.from(row.signer_ciphertext,'base64').toString().includes('secret-material'));
  assert.equal((await loadSessionSignerMaterial(db,'alice',fixture().signerAddress,KEY)),'secret-material');
 }finally{sql.close();}
});
test('an unknown outcome keeps its budget; a later intent cannot hide behind it',async()=>{
 const {db,sql}=ledger();try{
  await submitOnce(request({db,signer:async()=>{throw Error('uncertain');}}));
  const f=fixture();const calls:string[]=[];const second=request({db,signer:async()=>{calls.push('signer');return hex64('8');}},calls);
  const bumped={...second,evidence:{...f.evidence,route:{...f.evidence.route,id:'second'} as RouteEvidence,intentDigest:hex64('c'),approval:{...f.evidence.approval,intentDigest:hex64('c'),routeId:'second'},simulation:{...f.evidence.simulation,intentDigest:hex64('c'),routeId:'second'}},candidate:{...f.candidate,intentDigest:hex64('c'),from:f.address}};
  const over={...bumped,accounting:{...f.accounting,daily:{day:'2026-09-27',filledCents:0,pendingCents:150}}};
  const result=await submitOnce(over);
  assert.equal(result.outcome,'blocked');assert.equal(calls.length,0);
  assert.ok((result as{reasons:string[]}).reasons.length>0);
  assert.equal(await getAttempt(db,'alice',hex64('c')),null);
 }finally{sql.close();}
});
