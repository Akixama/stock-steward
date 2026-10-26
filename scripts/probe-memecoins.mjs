// Read-only survey of Robinhood Chain memecoin markets. Sends no transactions.
// Usage: node scripts/probe-memecoins.mjs > memecoin-probe.json
// Prints what Stock Steward needs before memecoin trading is built: which
// pools hold the liquidity, what they are paired with, fee/tickSpacing/hooks,
// and whether a direct USDG pool exists on the venue Steward already uses.
import {encodeAbiParameters,encodeFunctionData,decodeFunctionResult,keccak256,parseAbi} from 'viem';

const RPC='https://rpc.mainnet.chain.robinhood.com/';
const STATE='0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const ZERO='0x0000000000000000000000000000000000000000';
const TIERS=[[100,1],[500,10],[3000,60],[10000,200]];
const stateAbi=parseAbi(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)','function getLiquidity(bytes32) view returns (uint128)']);
const erc=parseAbi(['function symbol() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function owner() view returns (address)']);

const get=async(url)=>{const r=await fetch(url,{headers:{accept:'application/json'}});if(!r.ok)throw Error(`${r.status} ${url}`);return r.json();};
let id=0;
async function call(to,abi,fn,args=[]){
 const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'eth_call',params:[{to,data:encodeFunctionData({abi,functionName:fn,args})},'latest']})});
 const b=await r.json();if(b.error||!b.result||b.result==='0x')return null;
 try{return decodeFunctionResult({abi,functionName:fn,data:b.result});}catch{return null;}
}
async function code(addr){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'eth_getCode',params:[addr,'latest']})});return (await r.json()).result??'0x';}
function poolId(a,b,fee,ts,hooks=ZERO){const [c0,c1]=[a.toLowerCase(),b.toLowerCase()].sort();return keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[c0,c1,fee,ts,hooks]));}

const out={observedAt:new Date().toISOString(),network:null,pools:[],tokens:[],errors:[]};
// 1. Find GeckoTerminal's id for Robinhood Chain.
for(let page=1;page<=10&&!out.network;page++){
 try{const n=await get(`https://api.geckoterminal.com/api/v2/networks?page=${page}`);const hit=n.data?.find(x=>/robinhood/i.test(x.attributes?.name??'')||/robinhood/i.test(x.id));if(hit)out.network=hit.id;if(!n.data?.length)break;}catch(e){out.errors.push(String(e));break;}
}
if(!out.network){console.log(JSON.stringify(out,null,1));process.exit(1);}
// 2. Top pools by volume (3 pages ≈ 60 pools), plus their DEX ids and quote tokens.
const seen=new Map();
for(let page=1;page<=3;page++){
 try{const p=await get(`https://api.geckoterminal.com/api/v2/networks/${out.network}/pools?page=${page}&sort=h24_volume_usd_desc&include=base_token,quote_token,dex`);
  const inc=new Map((p.included??[]).map(x=>[x.id,x]));
  for(const pool of p.data??[]){
   const a=pool.attributes,rel=pool.relationships;const base=inc.get(rel.base_token.data.id)?.attributes,quote=inc.get(rel.quote_token.data.id)?.attributes;
   out.pools.push({name:a.name,poolAddressOrId:a.address,dex:rel.dex.data.id,base:{symbol:base?.symbol,address:base?.address},quote:{symbol:quote?.symbol,address:quote?.address},reserveUsd:Number(a.reserve_in_usd),volume24hUsd:Number(a.volume_usd?.h24),fdvUsd:Number(a.fdv_usd),createdAt:a.pool_created_at});
   if(base?.address&&!seen.has(base.address.toLowerCase()))seen.set(base.address.toLowerCase(),{symbol:base.symbol,quotes:new Set()});
   if(base?.address)seen.get(base.address.toLowerCase()).quotes.add(quote?.address?.toLowerCase());
  }
 }catch(e){out.errors.push(String(e));}
}
// 3. For the top 25 tokens: basics, owner, proxy slot, and v4 pools vs USDG and each seen quote (no hooks).
const IMPL_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
for(const [addr,t] of [...seen].slice(0,25)){
 const row={address:addr,symbol:t.symbol,code:null,decimals:null,totalSupply:null,owner:null,proxyImplementation:null,v4Pools:[]};
 try{
  const c=await code(addr);row.code=c==='0x'?'none':`${(c.length-2)/2} bytes`;
  row.decimals=Number(await call(addr,erc,'decimals')??NaN);row.totalSupply=String(await call(addr,erc,'totalSupply')??'');row.owner=await call(addr,erc,'owner');
  const s=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'eth_getStorageAt',params:[addr,IMPL_SLOT,'latest']})}).then(r=>r.json());
  row.proxyImplementation=/^0x0*$/.test(s.result??'0x')?null:s.result;
  for(const q of new Set([USDG,...[...t.quotes].filter(Boolean)])){
   for(const [fee,ts] of TIERS){
    const pid=poolId(addr,q,fee,ts);const slot=await call(STATE,stateAbi,'getSlot0',[pid]);
    if(slot&&slot[0]!==0n){const liq=await call(STATE,stateAbi,'getLiquidity',[pid]);row.v4Pools.push({pair:q,fee,tickSpacing:ts,hooks:'none',liquidity:String(liq??'')});}
   }
  }
 }catch(e){row.error=String(e);}
 out.tokens.push(row);
}
console.log(JSON.stringify(out,null,1));
