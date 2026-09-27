import {decodeEventLog,keccak256,parseAbi,type Hex} from 'viem';
import {CHAIN} from './robinhood-chain.ts';
import {VENUE,type RouteEvidence} from './chain-route.ts';
import {routerCandidate,validateRouterCandidate} from './router-candidate.ts';
const transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const hash=(x:unknown):x is Hex=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const quantity=(x:unknown):x is string=>typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x);
export type FillProof={hash:string;intentDigest:string;canonicalFinalized:boolean;outcome:'verified_fill'|'reverted'|'unknown';blockHash:string|null;actualInputRaw:string|null;actualOutputRaw:string|null;calldataHash:string;checkedAt:string;executionKind:'direct-router';delegatedAccountVerified:false;why:string};
// Direct-router evidence only. Bundled user operations need their own envelope and event validation.
export async function reconcileDirectFill(route:RouteEvidence,version:number,transactionHash:string,expectedCodeHash:string,fetcher:typeof fetch=fetch):Promise<FillProof>{
 if(!hash(transactionHash)||!hash(expectedCodeHash))throw Error('Invalid reconciliation identity');
 const candidate=routerCandidate(route,version),record:FillProof={hash:transactionHash.toLowerCase(),intentDigest:candidate.intentDigest,canonicalFinalized:false,outcome:'unknown',blockHash:null,actualInputRaw:null,actualOutputRaw:null,calldataHash:candidate.calldataHash,checkedAt:new Date().toISOString(),executionKind:'direct-router',delegatedAccountVerified:false,why:'Exact direct-router evidence is unavailable. No budget is released.'};
 let serial=0;async function rpc(method:string,params:unknown[]){const id=++serial,r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(10000),cache:'no-store'});if(!r.ok)throw Error('RPC unavailable');const b=await r.json() as {id:number;result?:unknown;error?:unknown};if(b.id!==id||b.error||!Object.hasOwn(b,'result'))throw Error('RPC unavailable');return b.result;}
 try{
 if(await rpc('eth_chainId',[])!==CHAIN.hex)throw Error('Wrong chain');
 const tx=await rpc('eth_getTransactionByHash',[record.hash]) as {hash:string;from:string;to:string;input:string;value:string;blockHash:string;blockNumber:string}|null;
 if(!tx||tx.hash?.toLowerCase()!==record.hash||!validateRouterCandidate(route,version,{from:tx.from,to:tx.to,data:tx.input,value:tx.value})||!hash(tx.blockHash)||!quantity(tx.blockNumber))throw Error('Envelope mismatch');
 const receipt=await rpc('eth_getTransactionReceipt',[record.hash]) as {transactionHash:string;blockHash:string;blockNumber:string;status:string;logs:{address:string;topics:Hex[];data:Hex;removed?:boolean;transactionHash:string;blockHash:string;logIndex:string}[]}|null;
 if(!receipt||receipt.transactionHash?.toLowerCase()!==record.hash||receipt.blockHash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber||!['0x0','0x1'].includes(receipt.status)||!Array.isArray(receipt.logs)||receipt.logs.length>2000)throw Error('Receipt mismatch');
 const block=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]) as {hash:string;number:string;timestamp:string};
 if(block?.hash!==tx.blockHash||block.number!==tx.blockNumber||!quantity(block.timestamp))throw Error('Noncanonical inclusion');
 const head=await rpc('eth_blockNumber',[]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]) as {hash:string;number:string}|null;
 if(!quantity(head)||!finalized||!hash(finalized.hash)||!quantity(finalized.number)||BigInt(finalized.number)<BigInt(tx.blockNumber)||BigInt(finalized.number)>BigInt(head))throw Error('Finality unavailable');
 const finalHeader=await rpc('eth_getBlockByNumber',[finalized.number,false]) as {hash:string};if(finalHeader?.hash!==finalized.hash)throw Error('Finalized anchor mismatch');
 const code=await rpc('eth_getCode',[candidate.to,tx.blockNumber]);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code as Hex)!==expectedCodeHash)throw Error('Execution code mismatch');
 const canonical=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]) as {hash:string};if(canonical?.hash!==tx.blockHash)throw Error('Inclusion changed');
 record.blockHash=tx.blockHash;
 if(receipt.status==='0x0')return {...record,canonicalFinalized:true,outcome:'reverted',why:'The exact direct-router transaction reverted in a provider-finalized canonical block. Gas may still have been spent.'};
 // Success must occur before the intent deadline. Uniswap uses block.timestamp for its deadline.
 if(BigInt(block.timestamp)*1000n>BigInt(Math.floor(Date.parse(route.expiresAt)/1000))*1000n||BigInt(block.timestamp)*1000n<BigInt(Date.parse(route.blockAt)))throw Error('Execution time mismatch');
 let inputOut=0n,inputIn=0n,outputIn=0n,outputOut=0n;const seen=new Set<string>();
 for(const log of receipt.logs){if(typeof log.address!=='string')throw Error('Malformed log');const token=log.address.toLowerCase();if(token!==route.settlement.toLowerCase()&&token!==route.token.toLowerCase())continue;
 if(log.removed||log.transactionHash?.toLowerCase()!==record.hash||log.blockHash!==tx.blockHash||!quantity(log.logIndex)||seen.has(log.logIndex))throw Error('Log provenance mismatch');seen.add(log.logIndex);
 // Other event signatures on these contracts do not describe a transfer.
 if(log.topics?.[0]!==keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')))continue;
 if(log.topics.length!==3)throw Error('Malformed transfer topics');
 const decoded=decodeEventLog({abi:transferAbi,data:log.data,topics:log.topics as [Hex,...Hex[]],strict:true});const {from,to,value}=decoded.args,owner=route.address.toLowerCase();
 if(token===route.settlement.toLowerCase()){if(from.toLowerCase()===owner){if(to.toLowerCase()!==VENUE.manager)throw Error('Settlement recipient mismatch');inputOut+=value;}if(to.toLowerCase()===owner)inputIn+=value;}
 else{if(to.toLowerCase()===owner){if(from.toLowerCase()!==VENUE.manager)throw Error('Output source mismatch');outputIn+=value;}if(from.toLowerCase()===owner)outputOut+=value;}
 }
 if(inputOut!==BigInt(route.inputRaw)||inputIn!==0n||outputOut!==0n||outputIn<BigInt(route.minimumOutputRaw!))throw Error('Transfer bounds mismatch');
 return {...record,canonicalFinalized:true,outcome:'verified_fill',actualInputRaw:inputOut.toString(),actualOutputRaw:outputIn.toString(),why:'Exact direct-router calldata and bounded token transfers verified in a provider-finalized canonical block. This does not verify a delegated user operation.'};
 }catch{return {...record,canonicalFinalized:false,outcome:'unknown',actualInputRaw:null,actualOutputRaw:null};}
}
