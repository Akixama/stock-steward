import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import {mandateDigest,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';
import {inspectRolesInstallation} from './roles-installation.ts';
import {CHAIN} from './robinhood-chain.ts';
import type {Hex} from 'viem';
export async function verifyAutonomousGrant(snapshot:MandateSnapshot,policy:RolesPolicy,lease:PolicyLease,expected:{from:string;to:string;data:string;value:string},creationTx:Hex,grantTx:Hex,fetcher:typeof fetch=fetch){
 const no={verified:false as const,why:'The session grant could not be verified. Automatic spending remains off.'};
 try{
  if(!/^0x[0-9a-f]{64}$/i.test(creationTx)||!/^0x[0-9a-f]{64}$/i.test(grantTx)||lease.policyHash!==compileRolesPolicy(policy).policyHash||lease.mandateDigest!==mandateDigest(snapshot)||lease.mandateVersion!==snapshot.version||expected.from.toLowerCase()!==snapshot.owner.toLowerCase()||expected.to.toLowerCase()!==policy.account.toLowerCase()||BigInt(expected.value)!==0n)return no;
  const rpc=async(method:string,params:unknown[])=>{const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000),cache:'no-store'});const b=await r.json() as {id:number;error?:unknown;result:unknown};if(!r.ok||b.id!==1||b.error)throw Error();return b.result;};
  const tx=await rpc('eth_getTransactionByHash',[grantTx]) as {hash:string;from:string;to:string;input:string;value:string;blockHash:string;blockNumber:Hex};
  const receipt=await rpc('eth_getTransactionReceipt',[grantTx]) as {transactionHash:string;status:string;blockHash:string;blockNumber:Hex};
  const same=(a:string,b:string)=>a?.toLowerCase()===b?.toLowerCase();
  if(!tx||!receipt||receipt.status!=='0x1'||!same(tx.hash,grantTx)||!same(receipt.transactionHash,grantTx)||!same(tx.from,expected.from)||!same(tx.to,expected.to)||!same(tx.input,expected.data)||BigInt(tx.value)!==0n||!same(tx.blockHash,receipt.blockHash)||tx.blockNumber!==receipt.blockNumber)return no;
  const header=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as {hash:string};if(!same(header?.hash,receipt.blockHash))return no;
  const state=await inspectRolesInstallation(policy,creationTx,fetcher);
  if(state.state!=='verified_policy_state'||state.walletOwners.length!==1||!same(state.walletOwners[0],snapshot.owner))return no;
  // Outer success alone never establishes the grant: exact current condition
  // history, ownership, provenance and session membership must also match.
  if(!same((await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as {hash:string})?.hash,receipt.blockHash))return no;
  return {verified:true as const,why:'Exact owner transaction and current bounded session permission verified. Automatic spending remains off.',observedAt:state.observedAt,blockHash:state.blockHash};
 }catch{return no;}
}
