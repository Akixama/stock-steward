import {decodeEventLog,keccak256,parseAbi,type Hex,type Address} from 'viem';
import {compileRolesPolicy,approvedRouterCall,encodeRolesExecution,type RolesPolicy} from './roles-permission.ts';
import {inspectRolesInstallation} from './roles-installation.ts';
import {CHAIN} from './robinhood-chain.ts';
import {VENUE,type RouteEvidence} from './chain-route.ts';
import {tradeIntent} from './trade-intent.ts';
import {routerCandidate,validateRouterCandidate} from './router-candidate.ts';
import {earlyConfirmationCount,hasEarlyConfirmations} from './confirmation-status.ts';
import {boundOwnerEnvelope,DELEGATION_MANAGER,DELEGATION_MANAGER_RUNTIME_HASH,type BoundOrderTransaction} from './delegated-order-envelope.ts';
const transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const hash=(x:unknown):x is Hex=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const quantity=(x:unknown):x is string=>typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x);
export type FillProof={hash:string;intentDigest:string;canonicalFinalized:boolean;outcome:'verified_fill'|'reverted'|'unknown';blockHash:string|null;actualInputRaw:string|null;actualOutputRaw:string|null;calldataHash:string;checkedAt:string;executionKind:'direct-router'|'roles-module';delegatedAccountVerified:boolean;why:string;transactionSucceeded?:boolean;awaitingFinality?:boolean;confirmedFill?:boolean;reorged?:boolean};
// Direct-router evidence only. Bundled user operations need their own envelope and event validation.
export async function reconcileDirectFill(route:RouteEvidence,version:number,transactionHash:string,expectedCodeHash:string,fetcher:typeof fetch=fetch):Promise<FillProof>{return reconcileBoundFill(route,version,transactionHash,expectedCodeHash,fetcher);}
export async function reconcileRolesFill(route:RouteEvidence,version:number,transactionHash:string,policy:RolesPolicy,creationTx:Hex,fetcher:typeof fetch=fetch):Promise<FillProof>{
 const plan=compileRolesPolicy(policy),candidate=routerCandidate(route,version),call=approvedRouterCall(policy,route.token as Address,Math.floor(Date.parse(route.expiresAt)/1000),route.side??'buy');
 if(policy.account.toLowerCase()!==route.address.toLowerCase()||!validateRouterCandidate(route,version,call)||call.data!==candidate.data)throw Error('Permission and route differ');
 const envelope=encodeRolesExecution(policy.module,plan.roleKey,call);
 return reconcileBoundFill(route,version,transactionHash,policy.routerCodeHash,fetcher,{from:policy.session,to:envelope.to,data:envelope.data,value:envelope.value,verify:async(block:Hex,blockHash:string)=>{const state=await inspectRolesInstallation(policy,creationTx,fetcher,block);return state.state==='verified_policy_state'&&state.blockHash===blockHash;}});
}
// Owner-signed orders reconcile through this wrapper: the exact envelope the wallet
// signed is re-verified, including a caller-supplied historical permission check.
export async function reconcileOwnerOrderFill(route:RouteEvidence,version:number,transactionHash:string,expectedCodeHash:string,envelope:{from:string;to:string;data:string;value:string;verify:(block:Hex,hash:string)=>Promise<boolean>},fetcher:typeof fetch=fetch,confirmationBlocks=earlyConfirmationCount(),managerRuntimeHash=DELEGATION_MANAGER_RUNTIME_HASH):Promise<FillProof>{
 return reconcileBoundFill(route,version,transactionHash,expectedCodeHash,fetcher,envelope,true,confirmationBlocks,managerRuntimeHash);
}
async function reconcileBoundFill(route:RouteEvidence,version:number,transactionHash:string,expectedCodeHash:string,fetcher:typeof fetch,envelope?:{from:string;to:string;data:string;value:string;verify:(block:Hex,hash:string)=>Promise<boolean>},allowConfirmed=false,confirmationBlocks=earlyConfirmationCount(),managerRuntimeHash=DELEGATION_MANAGER_RUNTIME_HASH):Promise<FillProof>{
 if(!hash(transactionHash)||!hash(expectedCodeHash))throw Error('Invalid reconciliation identity');
 const candidate=routerCandidate(route,version),record:FillProof={hash:transactionHash.toLowerCase(),intentDigest:candidate.intentDigest,canonicalFinalized:false,outcome:'unknown',blockHash:null,actualInputRaw:null,actualOutputRaw:null,calldataHash:candidate.calldataHash,checkedAt:new Date().toISOString(),executionKind:envelope?'roles-module':'direct-router',delegatedAccountVerified:false,why:'Exact direct-router evidence is unavailable. No budget is released.'};
 let serial=0;async function rpc(method:string,params:unknown[]){const id=++serial,r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(10000),cache:'no-store'});if(!r.ok)throw Error('RPC unavailable');const b=await r.json() as {id:number;result?:unknown;error?:unknown};if(b.id!==id||b.error||!Object.hasOwn(b,'result'))throw Error('RPC unavailable');return b.result;}
 try{
 if(await rpc('eth_chainId',[])!==CHAIN.hex)throw Error('Wrong chain');
 const tx=await rpc('eth_getTransactionByHash',[record.hash]) as ({hash:string;from:string;to:string;input:string;value:string;blockHash:string;blockNumber:string}&BoundOrderTransaction)|null;
 const ownerEnvelope=envelope&&tx?boundOwnerEnvelope(tx,envelope):null;
 if(!tx||tx.hash?.toLowerCase()!==record.hash||!(envelope?ownerEnvelope!==null:validateRouterCandidate(route,version,{from:tx.from,to:tx.to,data:tx.input,value:tx.value}))||!hash(tx.blockHash)||!quantity(tx.blockNumber))throw Error('Envelope mismatch');
 const receipt=await rpc('eth_getTransactionReceipt',[record.hash]) as {transactionHash:string;blockHash:string;blockNumber:string;status:string;logs:{address:string;topics:Hex[];data:Hex;removed?:boolean;transactionHash:string;blockHash:string;logIndex:string}[]}|null;
 if(!receipt||receipt.transactionHash?.toLowerCase()!==record.hash||receipt.blockHash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber||!['0x0','0x1'].includes(receipt.status)||!Array.isArray(receipt.logs)||receipt.logs.length>2000)throw Error('Receipt mismatch');
 const block=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]) as {hash:string;number:string;timestamp:string};
 if(block?.hash!==tx.blockHash||block.number!==tx.blockNumber||!quantity(block.timestamp))throw Error('Noncanonical inclusion');
 record.transactionSucceeded=receipt.status==='0x1';
 const head=await rpc('eth_blockNumber',[]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]) as {hash:string;number:string}|null;
 if(finalized&&quantity(finalized.number)&&BigInt(finalized.number)<BigInt(tx.blockNumber)) { record.awaitingFinality=true;record.why='Transaction included; waiting for the chain finalized checkpoint. Do not submit it again.'; }
 const isFinalized=quantity(head)&&!!finalized&&hash(finalized.hash)&&quantity(finalized.number)&&BigInt(finalized.number)>=BigInt(tx.blockNumber)&&BigInt(finalized.number)<=BigInt(head);
 const isEarlyConfirmed=hasEarlyConfirmations(head,tx.blockNumber,confirmationBlocks);
 if(!allowConfirmed&&!isFinalized)throw Error('Finality unavailable');

 if(isFinalized){const finalHeader=await rpc('eth_getBlockByNumber',[finalized.number,false]) as {hash:string};if(finalHeader?.hash!==finalized.hash)throw Error('Finalized anchor mismatch');}
 const code=await rpc('eth_getCode',[candidate.to,tx.blockNumber]);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code as Hex)!==expectedCodeHash)throw Error('Execution code mismatch');
 if(ownerEnvelope==='delegated'){
  const managerCode=await rpc('eth_getCode',[DELEGATION_MANAGER,tx.blockNumber]);
  if(typeof managerCode!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(managerCode)||keccak256(managerCode as Hex)!==managerRuntimeHash)throw Error('Delegation manager code mismatch');
 }
 const canonical=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]) as {hash:string};if(canonical?.hash!==tx.blockHash)throw Error('Inclusion changed');
 record.blockHash=tx.blockHash;if(envelope){if(!await envelope.verify(tx.blockNumber as Hex,tx.blockHash))throw Error('Historical permission evidence unavailable');record.delegatedAccountVerified=true;}
 if(receipt.status==='0x0'&&!isFinalized)throw Error('Transaction reverted; awaiting finality. Do not resend yet.');
 if(receipt.status==='0x0')return {...record,canonicalFinalized:true,outcome:'reverted',why:'The exact direct-router transaction reverted in a provider-finalized canonical block. Gas may still have been spent.'};
 // Success must occur before the intent deadline. Uniswap uses block.timestamp for its deadline.
 if(BigInt(block.timestamp)*1000n>BigInt(Math.floor(Date.parse(route.expiresAt)/1000))*1000n||BigInt(block.timestamp)*1000n<BigInt(Date.parse(route.blockAt)))throw Error('Execution time mismatch');
 const intent=tradeIntent(route,version);let inputOut=0n,inputIn=0n,outputIn=0n,outputOut=0n;const seen=new Set<string>();
 for(const log of receipt.logs){if(typeof log.address!=='string')throw Error('Malformed log');const token=log.address.toLowerCase();if(token!==route.settlement.toLowerCase()&&token!==route.token.toLowerCase())continue;
 if(log.removed||log.transactionHash?.toLowerCase()!==record.hash||log.blockHash!==tx.blockHash||!quantity(log.logIndex)||seen.has(log.logIndex))throw Error('Log provenance mismatch');seen.add(log.logIndex);
 // Other event signatures on these contracts do not describe a transfer.
 if(log.topics?.[0]!==keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')))continue;
 if(log.topics.length!==3)throw Error('Malformed transfer topics');
 const decoded=decodeEventLog({abi:transferAbi,data:log.data,topics:log.topics as [Hex,...Hex[]],strict:true});const {from,to,value}=decoded.args,owner=route.address.toLowerCase();
 if(token===intent.inputToken.toLowerCase()){if(from.toLowerCase()===owner){if(to.toLowerCase()!==VENUE.manager)throw Error('Settlement recipient mismatch');inputOut+=value;}if(to.toLowerCase()===owner)inputIn+=value;}
 else{if(to.toLowerCase()===owner){if(from.toLowerCase()!==VENUE.manager)throw Error('Output source mismatch');outputIn+=value;}if(from.toLowerCase()===owner)outputOut+=value;}
 }
 if(inputOut!==BigInt(route.inputRaw)||inputIn!==0n||outputOut!==0n||outputIn<BigInt(route.minimumOutputRaw!))throw Error('Transfer bounds mismatch');
 return {...record,confirmedFill:isFinalized||isEarlyConfirmed,awaitingFinality:!isFinalized,canonicalFinalized:isFinalized,outcome:isFinalized?'verified_fill':'unknown',actualInputRaw:inputOut.toString(),actualOutputRaw:outputIn.toString(),why:isFinalized?'Exact transaction and token transfers verified in a finalized canonical block.':isEarlyConfirmed?'Confirmed onchain; finality is expected in about 15 minutes. This action stays reserved until finalized.':'Exact transaction and token transfers found; waiting for additional block confirmations.'};
 }catch(error){const why=error instanceof Error?error.message:'Receipt verification unavailable';return {...record,canonicalFinalized:false,outcome:'unknown',actualInputRaw:null,actualOutputRaw:null,reorged:why==='Noncanonical inclusion'||why==='Inclusion changed',why};}
}
