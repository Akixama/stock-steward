import {decodeEventLog,decodeFunctionResult,encodeFunctionData,keccak256,parseAbi,type Hex} from 'viem';
import {CHAIN} from './robinhood-chain.ts';import {EXECUTION_CONTRACTS} from './autonomy.ts';
import {compileRolesPolicy,rolesAbi,rolesFactoryAbi,ROLES_CONTRACTS,ROLES_RUNTIME_HASHES,type RolesPolicy} from './roles-permission.ts';
import {SAFE_RUNTIME_HASHES} from './safe-setup.ts';

const safeAbi=parseAbi(['function getOwners() view returns (address[])','function getThreshold() view returns (uint256)','function getModulesPaginated(address start,uint256 pageSize) view returns (address[],address)','function isModuleEnabled(address module) view returns (bool)']);
const moduleAbi=parseAbi(['function isModuleEnabled(address module) view returns (bool)','function defaultRoles(address module) view returns (bytes32)','function unwrappers(bytes32 key) view returns (address)']);
const events=parseAbi([
 'event AssignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',
 'event ScopeTarget(bytes32 roleKey,address targetAddress)',
 'event AllowTarget(bytes32 roleKey,address targetAddress,uint8 options)',
 'event RevokeTarget(bytes32 roleKey,address targetAddress)',
 'event ScopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',
 'event AllowFunction(bytes32 roleKey,address targetAddress,bytes4 selector,uint8 options)',
 'event RevokeFunction(bytes32 roleKey,address targetAddress,bytes4 selector)',
]);
const SAFE_PROXY_HASH=SAFE_RUNTIME_HASHES.proxy,SAFE_SINGLETON_HASH=SAFE_RUNTIME_HASHES.singleton;
const ZERO='0x0000000000000000000000000000000000000000',SENTINEL='0x0000000000000000000000000000000000000001';
type Log={address:string;topics:Hex[];data:Hex;blockNumber:Hex;blockHash:Hex;transactionHash:Hex;logIndex:Hex;removed?:boolean};
export type RolesInstallation={state:'verified_policy_state'|'blocked';observedAt:string;block:Hex|null;blockHash:Hex|null;policyHash:string|null;dailyRemainingCalls:string|null;totalRemainingCalls:string|null;walletOwners:string[];walletOwnershipVerified:false;executionEnabled:false;why:string};
// Server-side chain inspection only. A client-supplied boolean/signature cannot verify policy state.
// Fingerprints identify the locally tested runtimes; they are not an independent source audit.
export async function inspectRolesInstallation(policy:RolesPolicy,creationTx:Hex,fetcher:typeof fetch=fetch):Promise<RolesInstallation>{
 const result:RolesInstallation={state:'blocked',observedAt:new Date().toISOString(),block:null,blockHash:null,policyHash:null,dailyRemainingCalls:null,totalRemainingCalls:null,walletOwners:[],walletOwnershipVerified:false,executionEnabled:false,why:'Installed permission evidence is unavailable or does not match the tested policy.'};
 let serial=0,stage='policy';const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 async function rpc(method:string,params:unknown[]){const id=++serial,r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(15000),cache:'no-store'});if(!r.ok)throw Error();const b=await r.json() as {id:number;result?:unknown;error?:unknown};if(b.id!==id||b.error||!Object.hasOwn(b,'result'))throw Error();return b.result;}
 async function codeHash(address:string,block:Hex){const code=await rpc('eth_getCode',[address,block]);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error();return {code,hash:keccak256(code as Hex)};}
 async function call(address:string,abi:Parameters<typeof encodeFunctionData>[0]['abi'],functionName:string,args:unknown[],block:Hex){const data=encodeFunctionData({abi,functionName,args});const raw=await rpc('eth_call',[{to:address,data},block]);if(typeof raw!=='string')throw Error();return decodeFunctionResult({abi,functionName,data:raw as Hex});}
 try{
  const plan=compileRolesPolicy(policy);result.policyHash=plan.policyHash;if(!/^0x[0-9a-f]{64}$/i.test(creationTx))throw Error();
  if(await rpc('eth_chainId',[])!==CHAIN.hex)throw Error();
  const block=await rpc('eth_blockNumber',[]);if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block))throw Error();
  const header=await rpc('eth_getBlockByNumber',[block,false]) as {number:Hex;hash:Hex;timestamp:Hex};
  if(header?.number!==block||!/^0x[0-9a-f]{64}$/i.test(header.hash)||!/^0x[0-9a-f]+$/i.test(header.timestamp))throw Error();const at=block as Hex;
  result.block=at;result.blockHash=header.hash;
  const now=Number(BigInt(header.timestamp));if(now>=policy.expiresAt||now<policy.startsAt)throw Error('Policy is outside its review interval');
  stage='runtime fingerprints';for(const [name,address] of Object.entries(ROLES_CONTRACTS)){if((await codeHash(address,at)).hash!==ROLES_RUNTIME_HASHES[name as keyof typeof ROLES_RUNTIME_HASHES])throw Error('Permission runtime changed');}
  if(!same((await codeHash(EXECUTION_CONTRACTS.router,at)).hash,policy.routerCodeHash))throw Error('Owner-reviewed router fingerprint changed');
  stage='module proxy';const moduleCode=(await codeHash(policy.module,at)).code.toLowerCase();
  // Factory's documented EIP-1167 runtime; reject other delegate implementations.
  const expected='0x363d3d373d3d3d363d73'+ROLES_CONTRACTS.roles.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3';
  if(moduleCode!==expected)throw Error('Unsupported module proxy');
  stage='wallet configuration';if((await codeHash(policy.account,at)).hash!==SAFE_PROXY_HASH)throw Error('Unsupported wallet proxy');
  stage='wallet singleton';const singletonWord=await rpc('eth_getStorageAt',[policy.account,'0x0',at]);if(typeof singletonWord!=='string'||!/^0x[0-9a-f]{64}$/i.test(singletonWord))throw Error();
  const singleton='0x'+singletonWord.slice(-40);if((await codeHash(singleton,at)).hash!==SAFE_SINGLETON_HASH)throw Error('Unsupported wallet singleton');
  stage='module ownership';for(const getter of ['owner','avatar','target'])if(!same(await call(policy.module,rolesAbi,getter,[],at) as string,policy.account))throw Error('Module admin/account mismatch');
  stage='wallet owners';const owners=await call(policy.account,safeAbi,'getOwners',[],at) as string[];const threshold=await call(policy.account,safeAbi,'getThreshold',[],at) as bigint;
  if(owners.length!==1||threshold!==1n||owners.some(o=>same(o,policy.session)||same(o,policy.module)))throw Error('Unsupported wallet ownership');result.walletOwners=owners;
  stage='wallet modules';const [modules,next]=await call(policy.account,safeAbi,'getModulesPaginated',[SENTINEL,20n],at) as [string[],string];
  if(modules.length!==1||!same(modules[0],policy.module)||!same(next,SENTINEL))throw Error('Unexpected wallet modules');
  // No fallback/guard configuration beyond the tested empty configuration.
  stage='wallet handlers';for(const slot of [keccak256(new TextEncoder().encode('fallback_manager.handler.address')),keccak256(new TextEncoder().encode('guard_manager.guard.address'))]){const raw=await rpc('eth_getStorageAt',[policy.account,slot,at]);if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{2}){0,32}$/i.test(raw)||BigInt(raw==='0x'?'0x0':raw)!==0n)throw Error('Unsupported wallet handler');}
  stage='session membership';if(!await call(policy.module,moduleAbi,'isModuleEnabled',[policy.session],at))throw Error('Session module disabled');
  const defaultRole=await call(policy.module,moduleAbi,'defaultRoles',[policy.session],at) as string;if(!/^0x0{64}$/i.test(defaultRole)&&!same(defaultRole,plan.roleKey))throw Error('Alternate default role');
  stage='transaction unwrapper';const unwrapKey=('0x'+EXECUTION_CONTRACTS.router.slice(2)+'3593564c'+'0'.repeat(16)) as Hex;
  if(!same(await call(policy.module,moduleAbi,'unwrappers',[unwrapKey],at) as string,ZERO))throw Error('Unexpected transaction unwrapper');
  stage='factory provenance';const creation=await rpc('eth_getTransactionReceipt',[creationTx]) as {status:string;blockNumber:Hex;blockHash:Hex;transactionHash:string;logs:Log[]};
  if(!creation||creation.status!=='0x1'||!same(creation.transactionHash,creationTx)||!/^0x[0-9a-f]+$/i.test(creation.blockNumber)||BigInt(creation.blockNumber)>BigInt(at)||!Array.isArray(creation.logs))throw Error('Missing module creation');
  const creationHeader=await rpc('eth_getBlockByNumber',[creation.blockNumber,false]) as {hash:Hex};if(creationHeader?.hash!==creation.blockHash)throw Error('Creation block changed');
  const provenance=creation.logs.some(log=>{try{if(!same(log.address,ROLES_CONTRACTS.factory)||log.removed||log.blockHash!==creation.blockHash||!same(log.transactionHash,creationTx))return false;const e=decodeEventLog({abi:rolesFactoryAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});return e.eventName==='ModuleProxyCreation'&&same(e.args.proxy,policy.module)&&same(e.args.masterCopy,ROLES_CONTRACTS.roles);}catch{return false;}});
  if(!provenance)throw Error('Module lacks trusted factory provenance');
  stage='configuration history';const history=await rpc('eth_getLogs',[{address:policy.module,fromBlock:creation.blockNumber,toBlock:at}]);if(!Array.isArray(history)||history.length>1000)throw Error('Incomplete configuration history');
  const memberships=new Map<string,boolean>(),targets=new Map<string,string>(),functions=new Map<string,{kind:string;conditions?:unknown;options?:number}>();
  const ids=new Set<string>();let previousBlock=-1n,previousIndex=-1n;
  for(const log of history as Log[]){
   if(!same(log.address,policy.module)||log.removed||!/^0x[0-9a-f]+$/i.test(log.blockNumber)||!/^0x[0-9a-f]+$/i.test(log.logIndex)||!/^0x[0-9a-f]{64}$/i.test(log.transactionHash)||!/^0x[0-9a-f]{64}$/i.test(log.blockHash)||BigInt(log.blockNumber)<BigInt(creation.blockNumber)||BigInt(log.blockNumber)>BigInt(at))throw Error('Invalid history');
   const bn=BigInt(log.blockNumber),index=BigInt(log.logIndex),id=log.transactionHash+':'+log.logIndex;if(ids.has(id)||bn<previousBlock||bn===previousBlock&&index<=previousIndex)throw Error('History not ordered');ids.add(id);previousBlock=bn;previousIndex=index;
   let event;try{event=decodeEventLog({abi:events,data:log.data,topics:log.topics as [Hex,...Hex[]]});}catch{continue;}
   const {eventName,args:a}=event;
   if(eventName==='AssignRoles'){if(!same(a.module,policy.session))continue;if(a.roleKeys.length!==a.memberOf.length)throw Error();a.roleKeys.forEach((key,i)=>memberships.set(key.toLowerCase(),a.memberOf[i]));continue;}
   if(!same(a.roleKey,plan.roleKey))continue;
   if(eventName==='ScopeTarget'||eventName==='AllowTarget'||eventName==='RevokeTarget'){targets.set(a.targetAddress.toLowerCase(),eventName);continue;}
   const key=a.targetAddress.toLowerCase()+':'+a.selector.toLowerCase();functions.set(key,{kind:eventName,conditions:eventName==='ScopeFunction'?a.conditions:undefined,options:eventName==='RevokeFunction'?undefined:a.options});
  }
  if(memberships.get(plan.roleKey.toLowerCase())!==true||[...memberships].some(([key,member])=>member&&key!==plan.roleKey.toLowerCase()))throw Error('Membership mismatch or alternate authority');
  if(targets.get(EXECUTION_CONTRACTS.router.toLowerCase())!=='ScopeTarget'||[...targets].some(([target,kind])=>kind!=='RevokeTarget'&&target!==EXECUTION_CONTRACTS.router.toLowerCase()))throw Error('Broad or alternate targets');
  const functionKey=EXECUTION_CONTRACTS.router.toLowerCase()+':0x3593564c';const scoped=functions.get(functionKey);
  if(!scoped||scoped.kind!=='ScopeFunction'||scoped.options!==0||JSON.stringify(scoped.conditions).toLowerCase()!==JSON.stringify(plan.conditions).toLowerCase()||[...functions].some(([key,v])=>key!==functionKey&&v.kind!=='RevokeFunction'))throw Error('Policy conditions differ');
  stage='quota configuration';for(const [key,max,period] of [[plan.dailyKey,BigInt(policy.dailyRaw)/BigInt(policy.inputRaw),86400n],[plan.totalKey,BigInt(policy.totalRaw)/BigInt(policy.inputRaw),0n]] as const){
   const [refill,maxRefill,actualPeriod,balance,timestamp]=await call(policy.module,rolesAbi,'allowances',[key],at) as [bigint,bigint,bigint,bigint,bigint];
   if(actualPeriod!==period||maxRefill!==max||refill!==(period?max:0n)||balance>max||timestamp>BigInt(now)||timestamp<BigInt(policy.startsAt)||timestamp%86400n!==0n)throw Error('Quota configuration changed');
   if(period)result.dailyRemainingCalls=(BigInt(now)>=timestamp+period?max:balance).toString();else result.totalRemainingCalls=balance.toString();
  }
  stage='canonical blocks';if((await rpc('eth_getBlockByNumber',[at,false]) as {hash:Hex})?.hash!==header.hash||(await rpc('eth_getBlockByNumber',[creation.blockNumber,false]) as {hash:Hex})?.hash!==creation.blockHash)throw Error('Canonical evidence changed');
  result.state='verified_policy_state';result.why='Tested runtime identities, compatible wallet configuration, factory provenance, exact scoped conditions and remaining quotas match at this block. Ownership, market evidence, fees and submission remain separate gates. No spending enabled.';
 }catch{result.state='blocked';result.dailyRemainingCalls=null;result.totalRemainingCalls=null;result.why='Installed permission check blocked at '+stage+'. No spending enabled.';}
 result.observedAt=new Date().toISOString();return result;
}
