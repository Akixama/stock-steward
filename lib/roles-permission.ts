import {decodeAbiParameters,decodeFunctionData,encodeAbiParameters,encodeFunctionData,keccak256,parseAbi,parseAbiParameters,toHex,type Address,type Hex} from 'viem';
import {EXECUTION_CONTRACTS} from './autonomy.ts';import {VENUE,poolIdentity} from './chain-route.ts';
import {routerCandidate} from './router-candidate.ts';import type {RouteEvidence} from './chain-route.ts';

export const ROLES_CONTRACTS={roles:'0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5',integrity:'0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049',packer:'0x869718c939652084bc491fbc5ce0d3c1d5b309f0',factory:'0x000000000000aDdB49795b0f9bA5BC298cDda236',singletonFactory:'0xce0042B868300000d44A59004Da54A005ffdcf9f'} as const;
export const rolesAbi=parseAbi([
 'function setUp(bytes initParams)',
 'function assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',
 'function scopeTarget(bytes32 roleKey,address targetAddress)',
 'function allowTarget(bytes32 roleKey,address targetAddress,uint8 options)',
 'function allowFunction(bytes32 roleKey,address targetAddress,bytes4 selector,uint8 options)',
 'function scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',
 'function setAllowance(bytes32 key,uint128 balance,uint128 maxRefill,uint128 refill,uint64 period,uint64 timestamp)',
 'function allowances(bytes32 key) view returns (uint128 refill,uint128 maxRefill,uint64 period,uint128 balance,uint64 timestamp)',
 'function revokeTarget(bytes32 roleKey,address targetAddress)',
 'function revokeFunction(bytes32 roleKey,address targetAddress,bytes4 selector)',
 'function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)',
 'function owner() view returns (address)','function avatar() view returns (address)','function target() view returns (address)',
]);
export const rolesFactoryAbi=parseAbi(['function deployModule(address masterCopy,bytes initializer,uint256 saltNonce) returns (address proxy)','event ModuleProxyCreation(address indexed proxy,address indexed masterCopy)']);
export const ROLES_RUNTIME_HASHES={roles:'0x471d8b3b419f1eb955230c0326c8812176df49bf3c7b414a563fda5a3c6c10b6',integrity:'0xee8ec55ea4ac609a3fc768eccf3f0479631454fe0a802e4a4b8132102d10d495',packer:'0xc28f5fb0c8857669286d01e3df89f310d5ddfbf98205ad46d2f7d28767a76c82',factory:'0x01623cbcf010a1c326230f1b2d5f48a66b440232ee49096102bc84967dc5f21e',singletonFactory:'0xc4d5542b53a8b779595a20a8ddd60e58a6c49d3c3decc2df83ced1c69c8ca807'} as const;
export function rolesDeploymentCall(account:Address,salt:Hex){
 if(!address(account)||!/^0x[0-9a-f]{64}$/i.test(salt))throw Error('Invalid module deployment');
 const initializer=encodeFunctionData({abi:rolesAbi,functionName:'setUp',args:[encodeAbiParameters(parseAbiParameters('address,address,address'),[account,account,account])]});
 return {to:ROLES_CONTRACTS.factory,data:encodeFunctionData({abi:rolesFactoryAbi,functionName:'deployModule',args:[ROLES_CONTRACTS.roles,initializer,BigInt(salt)]}),value:'0x0' as const,installationEnabled:false as const};
}
export type RolesPolicy={account:Address;module:Address;session:Address;grantId:Hex;routerCodeHash:Hex;startsAt:number;expiresAt:number;inputRaw:string;dailyRaw:string;totalRaw:string;outputs:{token:Address;fee:number;tickSpacing:number;minimumOutputRaw:string}[]};
type Node={paramType:number;operator:number;compValue:Hex;children:Node[]};
export type ConditionFlat={parent:number;paramType:number;operator:number;compValue:Hex};
const node=(paramType:number,operator:number,compValue:Hex='0x',children:Node[]=[]):Node=>({paramType,operator,compValue,children});
const word=(v:bigint)=>toHex(v,{size:32});
const equal=(value:bigint|string)=>node(1,16,typeof value==='bigint'?word(value):encodeAbiParameters(parseAbiParameters('address'),[value as Address]));
// Roles' Packer removes the dynamic offset itself; pass the complete abi.encode value.
const bytesEqual=(value:Hex)=>node(2,16,encodeAbiParameters(parseAbiParameters('bytes'),[value]));
const matches=(type:number,children:Node[])=>node(type,5,'0x',children);
function flatten(root:Node){const rows:ConditionFlat[]=[];const queue:{parent:number;n:Node}[]=[{parent:0,n:root}];for(let i=0;i<queue.length;i++){const {parent,n}=queue[i];rows.push({parent,paramType:n.paramType,operator:n.operator,compValue:n.compValue});for(const child of n.children)queue.push({parent:i,n:child});}if(rows.length>256)throw Error('Policy exceeds contract tree limit');return rows;}
const address=(s:string)=>/^0x[0-9a-f]{40}$/i.test(s)&&!/^0x0{40}$/i.test(s);
const raw=(s:string)=>/^\d{1,39}$/.test(s)&&BigInt(s)>0n&&BigInt(s)<=2n**128n-1n;
export function compileRolesPolicy(p:RolesPolicy){
 if(![p.account,p.module,p.session].every(address)||new Set([p.account,p.module,p.session].map(x=>x.toLowerCase())).size!==3||!/^0x[0-9a-f]{64}$/i.test(p.grantId)||/^0x0{64}$/i.test(p.grantId)||!/^0x[0-9a-f]{64}$/i.test(p.routerCodeHash)||/^0x0{64}$/i.test(p.routerCodeHash)||!Number.isSafeInteger(p.startsAt)||p.startsAt<1||p.startsAt%86400!==0||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=p.startsAt||p.expiresAt-p.startsAt>172800||![p.inputRaw,p.dailyRaw,p.totalRaw].every(raw)||BigInt(p.inputRaw)>BigInt(p.dailyRaw)||BigInt(p.inputRaw)>BigInt(p.totalRaw)||!p.outputs.length||p.outputs.length>3||p.outputs.some(o=>!address(o.token)||o.token.toLowerCase()===VENUE.settlement||!raw(o.minimumOutputRaw)||![[100,1],[500,10],[3000,60],[10000,200]].some(([f,t])=>f===o.fee&&t===o.tickSpacing))||new Set(p.outputs.map(o=>o.token.toLowerCase())).size!==p.outputs.length)throw Error('Invalid bounded Roles policy');
 const roleKey=keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,address,bytes32'),['stock-steward-role-v1',4663n,p.account,p.module,p.session,p.grantId]));
 const dailyKey=keccak256(encodeAbiParameters(parseAbiParameters('bytes32,string'),[roleKey,'daily']));
 const totalKey=keccak256(encodeAbiParameters(parseAbiParameters('bytes32,string'),[roleKey,'total']));
 const branches=p.outputs.map(o=>{
  // Heterogeneous swap/settle/take structs cannot share an Array ABI type tree.
  // Pin their entire encoded bytes, keeping a uniform Dynamic array element type.
  const data=approvedRouterCall(p,o.token,p.expiresAt-1).data;
  const decoded=decodeFunctionData({abi:parseAbi(['function execute(bytes,bytes[],uint256) payable']),data});
  const [,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),decoded.args[1][0]);
  // Matches enforces exactly one router input and exactly three action params.
  return matches(5,[bytesEqual('0x10'),matches(4,[matches(6,[bytesEqual('0x060c0f'),matches(4,params.map(bytesEqual))])]),node(1,18,word(BigInt(p.expiresAt))),node(0,30,dailyKey),node(0,30,totalKey)]);
 });
 const conditions=flatten(branches.length===1?branches[0]:node(0,2,'0x',branches));
 const selector='0x3593564c' as Hex;
 const calls=[
  {to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'scopeTarget',args:[roleKey,EXECUTION_CONTRACTS.router]})},
  {to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'scopeFunction',args:[roleKey,EXECUTION_CONTRACTS.router,selector,conditions,0]})},
  {to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'setAllowance',args:[dailyKey,BigInt(p.dailyRaw)/BigInt(p.inputRaw),BigInt(p.dailyRaw)/BigInt(p.inputRaw),BigInt(p.dailyRaw)/BigInt(p.inputRaw),86400n,BigInt(p.startsAt)]})},
  {to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'setAllowance',args:[totalKey,BigInt(p.totalRaw)/BigInt(p.inputRaw),BigInt(p.totalRaw)/BigInt(p.inputRaw),0n,0n,BigInt(p.startsAt)]})},
  // Membership last: incomplete installation grants no worker authority.
  {to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'assignRoles',args:[p.session,[roleKey],[true]]})},
 ];
 const revocation={to:p.module,data:encodeFunctionData({abi:rolesAbi,functionName:'assignRoles',args:[p.session,[roleKey],[false]]})};
 return {schema:'stock-steward-roles-v1' as const,chainId:4663,roleKey,dailyKey,totalKey,conditions,calls,revocation,policyHash:keccak256(toHex(JSON.stringify(p))),executionEnabled:false as const,installationEnabled:false as const,limitations:['Fixed-size raw USDG buys; quotas round down to whole buys. No dollar or portfolio guarantees.','Exact owner-set output floor encoded in each swap; no oracle-backed slippage guarantee.','Compatible avatar, clean module permissions and owner-controlled setup must be independently verified.','No root access, token approvals, native transfers, delegatecall or account-admin access in this policy.']};
}
export function approvedRouterCall(p:RolesPolicy,token:Address,deadline:number){
 const output=p.outputs.find(o=>o.token.toLowerCase()===token.toLowerCase());if(!output||!Number.isSafeInteger(deadline)||deadline>=p.expiresAt||deadline<=p.startsAt)throw Error('Call outside approved policy');
 const route={id:p.grantId,chainId:4663,address:p.account,settlement:VENUE.settlement,token,inputRaw:p.inputRaw,minimumOutputRaw:output.minimumOutputRaw,best:{state:'quoted',outputRaw:output.minimumOutputRaw,fee:output.fee,tickSpacing:output.tickSpacing,poolId:poolIdentity(token,output.fee,output.tickSpacing).poolId},expiresAt:new Date(deadline*1000).toISOString(),blockHash:'0x'+'0'.repeat(64)} as RouteEvidence;
 // Encodes only the owner-selected configuration. Synthetic fields are not quote evidence.
 const encoded=routerCandidate(route,null);
 return {from:encoded.from,to:encoded.to,data:encoded.data,value:encoded.value,ownerPolicyEncoding:true as const,submissionEnabled:false as const};
}
export function encodeRolesExecution(module:Address,roleKey:Hex,call:{to:Address;data:Hex}){
 if(!address(module)||!/^0x[0-9a-f]{64}$/i.test(roleKey)||call.to.toLowerCase()!==EXECUTION_CONTRACTS.router.toLowerCase())throw Error('Invalid Roles envelope');
 return {to:module,data:encodeFunctionData({abi:rolesAbi,functionName:'execTransactionWithRole',args:[call.to,0n,call.data,0,roleKey,true]}),value:'0x0' as const,executionEnabled:false as const};
}
