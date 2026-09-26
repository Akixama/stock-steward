import {CHAIN} from './robinhood-chain.ts';
export type TransactionWatch = {id:string;address:string;hash:string;createdAt:string;checkedAt:string;
  state:'pending'|'unknown'|'included_success'|'included_reverted'|'rpc_finalized_success'|'rpc_finalized_reverted'|'reorged'|'address_mismatch';
  blockNumber:string|null;blockHash:string|null;confirmations:string|null;why:string;source:string;investmentOutcome:'unverified'};
const hex=(value:unknown):value is string=>typeof value==='string' && /^0x[0-9a-f]+$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string' && /^0x[0-9a-f]{64}$/i.test(value);
const address=(value:unknown):value is string=>typeof value==='string' && /^0x[0-9a-f]{40}$/i.test(value);
export async function reconcileTransaction(wallet:string,transactionHash:string,previous:TransactionWatch|null=null,fetcher:typeof fetch=fetch):Promise<TransactionWatch> {
  if(!address(wallet)||!hash(transactionHash))throw new Error('Invalid transaction watch.');
  if(previous && (previous.address!==wallet.toLowerCase()||previous.hash!==transactionHash.toLowerCase()))throw new Error('Watch identity mismatch.');
  const now=new Date().toISOString();
  const record:TransactionWatch={id:previous?.id ?? crypto.randomUUID(),address:wallet.toLowerCase(),hash:transactionHash.toLowerCase(),createdAt:previous?.createdAt ?? now,checkedAt:now,
    state:'unknown',blockNumber:null,blockHash:null,confirmations:null,why:'Network evidence unavailable. No fill, failure or release is inferred.',source:'Robinhood mainnet RPC',investmentOutcome:'unverified'};
  const rpc=async(method:string,params:unknown[])=>{
    const response=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!response.ok)throw new Error('RPC unavailable');const data=await response.json() as {result?:unknown;error?:unknown};
    if(data.error || !Object.hasOwn(data,'result'))throw new Error('RPC unavailable');return data.result;
  };
  try {
    const chain=await rpc('eth_chainId',[]);if(!hex(chain)||BigInt(chain)!==BigInt(CHAIN.id))throw new Error('Wrong network');
    const tx=await rpc('eth_getTransactionByHash',[record.hash]) as {hash:string;from:string;to:string|null}|null;
    if(!tx){return {...record,state:previous?.blockHash?'reorged':'unknown',why:previous?.blockHash?'Previously included transaction is now absent from this provider; possible reorganization or provider lag. No budget was released.':'Transaction not found by this provider. This does not prove cancellation or failure.'};}
    if(!hash(tx.hash)||tx.hash.toLowerCase()!==record.hash||!address(tx.from))throw new Error('Invalid transaction');
    if(tx.from.toLowerCase()!==record.address && tx.to?.toLowerCase()!==record.address)return {...record,state:'address_mismatch',why:'Watched address is neither transaction sender nor recipient. This is not evidence about its portfolio.'};
    const receipt=await rpc('eth_getTransactionReceipt',[record.hash]) as {transactionHash:string;blockNumber:string;blockHash:string;status:string}|null;
    if(!receipt)return {...record,state:previous?.blockHash?'reorged':'pending',why:previous?.blockHash?'Previously observed receipt is absent; possible reorganization or provider lag. Still unresolved.':'Transaction is known but no inclusion receipt is available. No transaction is resubmitted.'};
    if(!hash(receipt.transactionHash)||receipt.transactionHash.toLowerCase()!==record.hash||!hex(receipt.blockNumber)||!hash(receipt.blockHash)||!['0x0','0x1'].includes(receipt.status))throw new Error('Invalid receipt');
    const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as {hash:string;number:string}|null;
    if(!block || !hash(block.hash) || !hex(block.number) || BigInt(block.number)!==BigInt(receipt.blockNumber))throw new Error('Invalid block');
    if(block.hash.toLowerCase()!==receipt.blockHash.toLowerCase())return {...record,state:'reorged',why:'Receipt block is not canonical according to this provider. No settlement or budget release was recorded.'};
    const head=await rpc('eth_blockNumber',[]);if(!hex(head)||BigInt(head)<BigInt(receipt.blockNumber))throw new Error('Invalid head');
    let finalized=false;
    try{const finalBlock=await rpc('eth_getBlockByNumber',['finalized',false]) as {number:string;hash:string}|null;finalized=!!finalBlock&&hex(finalBlock.number)&&hash(finalBlock.hash)&&BigInt(finalBlock.number)>=BigInt(receipt.blockNumber)&&BigInt(finalBlock.number)<=BigInt(head);}catch{/* Unsupported finality remains explicitly unfinalized. */}
    const success=receipt.status==='0x1';
    return {...record,state:finalized?(success?'rpc_finalized_success':'rpc_finalized_reverted'):(success?'included_success':'included_reverted'),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,
      confirmations:(BigInt(head)-BigInt(receipt.blockNumber)+1n).toString(),why:`${finalized?'Provider reports this block finalized':'Included in the currently canonical block; finality not established'}. ${success?'Outer transaction execution succeeded; swap output and user-operation success remain unverified':'Outer transaction reverted'}. This imported watch does not modify Steward spending accounting.`};
  }catch{return record;}
}
