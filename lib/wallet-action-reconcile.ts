import {decodeAbiParameters,decodeEventLog,decodeFunctionData,keccak256,parseAbi,parseAbiParameters,parseUnits,type Hex} from 'viem';
import {CHAIN,USDG} from './robinhood-chain.ts';
import {ownerSafeAbi,transferAbi} from './previous-wallet-transfer.ts';
import {MULTISEND} from './safe-setup.ts';
import {PERMIT2} from './install-flow.ts';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
import {VENUE} from './chain-route.ts';
import {earlyConfirmationCount,hasEarlyConfirmations} from './confirmation-status.ts';

const multiAbi=parseAbi(['function multiSend(bytes transactions)']);
const approveAbi=parseAbi(['function approve(address spender,uint256 amount) returns (bool)']);
const permitAbi=parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const routerAbi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const eventAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const swapAbi=parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');
const actionAbi=parseAbiParameters('bytes actions,bytes[] params');
const transferTopic=keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'));
const hex=(value:unknown):value is Hex=>typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value);
const hash=(value:unknown):value is Hex=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const addr=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

export type WalletActionProof={state:'confirmed'|'reverted'|'unknown';confirmation?:'confirmed'|'reverted'|'reorged';reason:string;hash:string;blockNumber?:string;inputRaw?:string;outputRaw?:string};
export type SavedWalletAction={kind:string;symbol:string;quantity:string;owner_address:string;safe:string;transaction_json:string;transaction_hash:string};
type ChainTx={hash:string;from:string;to:string;input:Hex;value:Hex;blockHash:string;blockNumber:Hex};
type Log={address:string;topics:Hex[];data:Hex;removed?:boolean;transactionHash:string;blockHash:string;logIndex:Hex};
type Receipt={transactionHash:string;blockHash:string;blockNumber:Hex;status:Hex;logs:Log[]};

function batchCalls(data:Hex){
 const decoded=decodeFunctionData({abi:multiAbi,data});if(decoded.functionName!=='multiSend')throw Error('Batch mismatch');
 const raw=decoded.args[0].slice(2);const calls:{to:string;data:Hex}[]=[];let cursor=0;
 while(cursor<raw.length){if(cursor+170>raw.length)throw Error('Truncated batch');const operation=Number.parseInt(raw.slice(cursor,cursor+2),16);cursor+=2;const to='0x'+raw.slice(cursor,cursor+40);cursor+=40;const value=BigInt('0x'+raw.slice(cursor,cursor+64));cursor+=64;const size=Number(BigInt('0x'+raw.slice(cursor,cursor+64)));cursor+=64;if(operation!==0||value!==0n||!Number.isSafeInteger(size)||cursor+size*2>raw.length)throw Error('Batch call mismatch');calls.push({to,data:('0x'+raw.slice(cursor,cursor+size*2)) as Hex});cursor+=size*2;}
 if(calls.length!==3)throw Error('Sale call count mismatch');return calls;
}

function expectedMovement(row:SavedWalletAction){
 const saved=JSON.parse(row.transaction_json) as {from:string;to:string;data:Hex;value:string};
 if(!addr(row.safe)||!addr(row.owner_address)||!same(saved.from,row.owner_address)||!same(saved.to,row.safe)||BigInt(saved.value)!==0n)throw Error('Saved wallet envelope mismatch');
 const outer=decodeFunctionData({abi:ownerSafeAbi,data:saved.data});if(outer.functionName!=='execTransaction')throw Error('Safe call mismatch');
 const [target,value,inner,operation]=outer.args;if(value!==0n)return null;
 if(row.kind==='transfer'){
  if(operation!==0||!addr(target))throw Error('Transfer Safe call mismatch');
  const transfer=decodeFunctionData({abi:transferAbi,data:inner});if(transfer.functionName!=='transfer'||!same(transfer.args[0],row.owner_address))throw Error('Transfer destination mismatch');
  if(row.symbol==='USDG'&&!same(target,USDG.contract))throw Error('USDG token mismatch');
  const amount=parseUnits(row.quantity,row.symbol==='USDG'?6:18);
  if(transfer.args[1]!==amount)throw Error('Transfer quantity mismatch');
  return {inputToken:target.toLowerCase(),inputRaw:amount,outputToken:null,minOutput:0n,destination:row.owner_address.toLowerCase()};
 }
 if(row.kind!=='sell'||operation!==1||!same(target,MULTISEND.address))throw Error('Sale Safe call mismatch');
 const calls=batchCalls(inner);const [approval,permit,router]=calls;
 const approved=decodeFunctionData({abi:approveAbi,data:approval.data});const permitted=decodeFunctionData({abi:permitAbi,data:permit.data});const executed=decodeFunctionData({abi:routerAbi,data:router.data});
 if(approved.functionName!=='approve'||permitted.functionName!=='approve'||executed.functionName!=='execute'||!same(approved.args[0],PERMIT2)||!same(permit.to,PERMIT2)||!same(router.to,EXECUTION_CONTRACTS.router)||!same(permitted.args[0],approval.to)||!same(permitted.args[1],EXECUTION_CONTRACTS.router)||executed.args[0]!=='0x10'||executed.args[1].length!==1)throw Error('Sale routing mismatch');
 const [actions,params]=decodeAbiParameters(actionAbi,executed.args[1][0]);if(actions!=='0x060c0f'||params.length!==3)throw Error('Sale actions mismatch');
 const [swap]=decodeAbiParameters(swapAbi,params[0]);const amount=parseUnits(row.quantity,18);
 if(swap.amountIn!==amount||approved.args[1]!==amount||permitted.args[2]!==amount||!same(approval.to,permitted.args[0])||!same(swap.poolKey.currency0,USDG.contract)&&!same(swap.poolKey.currency1,USDG.contract))throw Error('Sale input mismatch');
 const stock=approval.to.toLowerCase();if(!same(swap.poolKey.currency0,stock)&&!same(swap.poolKey.currency1,stock))throw Error('Sale stock mismatch');
 const [settleToken,settleAmount]=decodeAbiParameters(parseAbiParameters('address currency,uint256 amount'),params[1]);const [takeToken,takeAmount]=decodeAbiParameters(parseAbiParameters('address currency,uint256 amount'),params[2]);
 if(!same(settleToken,stock)||settleAmount!==amount||!same(takeToken,USDG.contract)||takeAmount!==swap.amountOutMinimum||swap.amountOutMinimum<=0n)throw Error('Sale bounds mismatch');
 return {inputToken:stock,inputRaw:amount,outputToken:USDG.contract.toLowerCase(),minOutput:swap.amountOutMinimum,destination:row.safe.toLowerCase()};
}

export async function reconcileWalletAction(row:SavedWalletAction,fetcher:typeof fetch=fetch,confirmationBlocks=earlyConfirmationCount()):Promise<WalletActionProof>{
 const result:WalletActionProof={state:'unknown',reason:'Chain proof is not available yet. Do not send again.',hash:row.transaction_hash};
 try{
  if(!hash(row.transaction_hash))throw Error('Saved hash invalid');
  let id=0;const rpc=async(method:string,params:unknown[])=>{const next=++id;const response=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:next,method,params}),cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('RPC unavailable');const body=await response.json() as {id:number;result?:unknown;error?:unknown};if(body.id!==next||body.error||!Object.hasOwn(body,'result'))throw Error('RPC unavailable');return body.result;};
  if(await rpc('eth_chainId',[])!==CHAIN.hex)throw Error('Wrong chain');
  const tx=await rpc('eth_getTransactionByHash',[row.transaction_hash]) as ChainTx|null;
  const receipt=await rpc('eth_getTransactionReceipt',[row.transaction_hash]) as Receipt|null;
  if(!tx||!receipt)throw Error('Waiting for transaction receipt');
  const saved=JSON.parse(row.transaction_json) as {from:string;to:string;data:string;value:string};
  if(!same(tx.hash,row.transaction_hash)||!same(tx.from,saved.from)||!same(tx.to,saved.to)||!same(tx.input,saved.data)||BigInt(tx.value)!==BigInt(saved.value)||!hash(tx.blockHash)||!hex(tx.blockNumber))throw Error('Transaction does not match saved action');
  if(!same(receipt.transactionHash,row.transaction_hash)||!same(receipt.blockHash,tx.blockHash)||BigInt(receipt.blockNumber)!==BigInt(tx.blockNumber)||!['0x0','0x1'].includes(receipt.status)||!Array.isArray(receipt.logs)||receipt.logs.length>2000)throw Error('Receipt mismatch');
  const [block,finalized,head]=await Promise.all([rpc('eth_getBlockByNumber',[tx.blockNumber,false]),rpc('eth_getBlockByNumber',['finalized',false]),rpc('eth_blockNumber',[])]);
  const included=block as {hash?:string;number?:string}|null;const final=finalized as {hash?:string;number?:string}|null;
  if(!included||!same(included.hash??'',tx.blockHash)||!hex(included.number)||BigInt(included.number)!==BigInt(tx.blockNumber))return {...result,confirmation:'reorged',reason:'The transaction is no longer in its recorded canonical block. Do not send again until resolved.'};
  if(!hex(head)||!final||!hash(final.hash)||!hex(final.number)||BigInt(final.number)>BigInt(head as string))throw Error('Chain checkpoint unavailable');
  const isFinalized=BigInt(final.number)>=BigInt(tx.blockNumber);
  if(isFinalized){const anchor=await rpc('eth_getBlockByNumber',[final.number,false]) as {hash?:string}|null;if(!anchor||!same(anchor.hash??'',final.hash))throw Error('Finalized checkpoint changed');const canonical=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]) as {hash?:string}|null;if(!canonical||!same(canonical.hash??'',tx.blockHash))throw Error('Transaction block changed');}
  result.blockNumber=tx.blockNumber;
  if(receipt.status==='0x0')return isFinalized?{...result,state:'reverted',reason:'Saved transaction reverted in a finalized canonical block.'}:{...result,confirmation:'reverted',reason:'Transaction reverted onchain; awaiting finality. Do not resend yet.'};
  const movement=expectedMovement(row);if(!movement)throw Error('Saved movement mismatch');
  let inputOut=0n,inputIn=0n,outputIn=0n,outputOut=0n;const indices=new Set<string>();
  for(const log of receipt.logs){if(!addr(log.address))throw Error('Malformed log');const token=log.address.toLowerCase();if(token!==movement.inputToken&&token!==movement.outputToken)continue;
   if(log.removed||!same(log.transactionHash,row.transaction_hash)||!same(log.blockHash,tx.blockHash)||!hex(log.logIndex)||indices.has(log.logIndex))throw Error('Log provenance mismatch');indices.add(log.logIndex);
   if(log.topics?.[0]!==transferTopic)continue;if(log.topics.length!==3)throw Error('Malformed token movement');
   const event=decodeEventLog({abi:eventAbi,data:log.data,topics:log.topics as [Hex,...Hex[]],strict:true});const {from,to,value}=event.args;
   if(token===movement.inputToken){if(same(from,row.safe)){if(row.kind==='sell'&&!same(to,VENUE.manager))throw Error('Sale input recipient mismatch');if(row.kind==='transfer'&&!same(to,row.owner_address))throw Error('Transfer recipient mismatch');inputOut+=value;}if(same(to,row.safe))inputIn+=value;}
   else if(token===movement.outputToken){if(same(to,row.safe)){if(!same(from,VENUE.manager))throw Error('Sale output source mismatch');outputIn+=value;}if(same(from,row.safe))outputOut+=value;}
  }
  if(inputOut!==movement.inputRaw||inputIn!==0n||outputOut!==0n||row.kind==='sell'&&outputIn<movement.minOutput)throw Error('Exact token movement proof missing');
  if(!isFinalized)return {...result,confirmation:hasEarlyConfirmations(head,tx.blockNumber,confirmationBlocks)?'confirmed':undefined,reason:hasEarlyConfirmations(head,tx.blockNumber,confirmationBlocks)?'Confirmed onchain; finality is expected in about 15 minutes. Do not send again.':'Exact token movement found; waiting for more block confirmations.',inputRaw:inputOut.toString(),outputRaw:outputIn.toString()};
  return {...result,state:'confirmed',reason:'Exact token movement verified in a finalized canonical block.',inputRaw:inputOut.toString(),outputRaw:outputIn.toString()};
 }catch(error){return {...result,reason:error instanceof Error?error.message:'Chain proof unavailable'};}
}
