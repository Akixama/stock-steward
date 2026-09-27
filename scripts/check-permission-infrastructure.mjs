import {readFile} from 'node:fs/promises';
import {keccak256} from 'viem';
import {chainTransport} from '../lib/chain-transport.ts';
import {CHAIN} from '../lib/robinhood-chain.ts';
// Official Zodiac 2.1.1 registry. Presence/fingerprint never proves audited implementation.
const contracts={roles:'0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5',integrity:'0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049',packer:'0x869718c939652084bc491fbc5ce0d3c1d5b309f0',factory:'0x000000000000aDdB49795b0f9bA5BC298cDda236'};
async function main(){
 let key=process.env.ALCHEMY_API_KEY?.trim();
 if(!key)key=JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json',import.meta.url),'utf8')).apiKey?.trim();
 if(!key||!/^[A-Za-z0-9_-]+$/.test(key))throw Error('RPC configuration unavailable');
 const fetcher=chainTransport(key);let serial=0;
 async function rpc(method,params){const id=++serial,r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const body=await r.json();if(body.id!==id||body.error||!Object.hasOwn(body,'result'))throw Error();return body.result;}
 if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error();
 const block=await rpc('eth_blockNumber',[]),header=await rpc('eth_getBlockByNumber',[block,false]);
 if(header?.number!==block||!/^0x[0-9a-f]{64}$/i.test(header.hash))throw Error();
 const evidence={};
 for(const [name,address] of Object.entries(contracts)){const code=await rpc('eth_getCode',[address,block]);if(!/^0x(?:[0-9a-f]{2})*$/i.test(code))throw Error();evidence[name]={address,bytes:(code.length-2)/2,codeHash:keccak256(code)};}
 if((await rpc('eth_getBlockByNumber',[block,false]))?.hash!==header.hash)throw Error();
 console.log(JSON.stringify({chainId:4663,block,blockHash:header.hash,observedAt:new Date().toISOString(),contracts:evidence,implementationVerified:false,accountCompatible:false,grantInstalled:false,executionEnabled:false,transactionSent:false}));
}
main().catch(()=>{console.error('Permission infrastructure evidence unavailable. No transaction sent.');process.exitCode=1;});
