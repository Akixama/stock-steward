import {pad,encodeEventTopics,type Hex} from 'viem';
import {ROLES_CONTRACTS,rolesFactoryAbi} from './roles-permission.ts';
import {CHAIN} from './robinhood-chain.ts';
// Finds the trusted factory transaction that created a Roles module, so the
// owner never has to paste it. The result is still fully re-verified by
// inspectRolesInstallation (receipt, block, factory log, master copy).
export async function findModuleCreation(module:string,fetcher:typeof fetch=fetch):Promise<Hex|null>{
 if(!/^0x[0-9a-f]{40}$/i.test(module))return null;
 const [signature]=encodeEventTopics({abi:rolesFactoryAbi,eventName:'ModuleProxyCreation'});
 const topics=[signature,pad(module.toLowerCase() as Hex,{size:32}),pad(ROLES_CONTRACTS.roles.toLowerCase() as Hex,{size:32})];
 try{
  const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[{address:ROLES_CONTRACTS.factory,topics,fromBlock:'0x0',toBlock:'latest'}]}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  const body=await r.json() as {id:number;result?:{transactionHash:Hex;removed?:boolean}[];error?:unknown};
  if(!r.ok||body.id!==1||body.error||!Array.isArray(body.result))return null;
  const live=body.result.filter(log=>!log.removed&&/^0x[0-9a-f]{64}$/i.test(log.transactionHash));
  return live.length===1?live[0].transactionHash:null;
 }catch{return null;}
}
