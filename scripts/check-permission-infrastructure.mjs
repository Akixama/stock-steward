import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {keccak256} from 'viem';
import {chainTransport} from '../lib/chain-transport.ts';
import {CHAIN} from '../lib/robinhood-chain.ts';
import {ROLES_CONTRACTS} from '../lib/roles-permission.ts';
import {EXECUTION_CONTRACTS} from '../lib/autonomy.ts';
import {VENUE} from '../lib/chain-route.ts';
import {SAFE_CONTRACTS,SAFE_RUNTIME_HASHES} from '../lib/safe-setup.ts';
// Official Zodiac 2.1.1 registry. Presence/fingerprint never proves audited implementation.
const contracts=ROLES_CONTRACTS;
async function main(){
 let key=process.env.ALCHEMY_API_KEY?.trim();
 if(!key)key=JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json',import.meta.url),'utf8')).apiKey?.trim();
 if(!key||!/^[A-Za-z0-9_-]+$/.test(key))throw Error('RPC configuration unavailable');
 const fetcher=chainTransport(key);let serial=0;
 async function rpc(method,params){const id=++serial,r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const body=await r.json();if(body.id!==id||body.error||!Object.hasOwn(body,'result'))throw Error();return body.result;}
 if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error();
 const block=await rpc('eth_blockNumber',[]),header=await rpc('eth_getBlockByNumber',[block,false]);
 if(header?.number!==block||!/^0x[0-9a-f]{64}$/i.test(header.hash))throw Error();
 const evidence={},runtimes={};
 for(const [name,address] of Object.entries(contracts)){const code=await rpc('eth_getCode',[address,block]);if(!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error();evidence[name]={address,bytes:(code.length-2)/2,codeHash:keccak256(code)};runtimes[name]={address,code,codeHash:keccak256(code)};}
 const swapContracts={},safeContracts={};
 if(process.argv.includes('--snapshot'))for(const [name,address] of Object.entries({router:EXECUTION_CONTRACTS.router,permit2:EXECUTION_CONTRACTS.permit2,manager:VENUE.manager})){const code=await rpc('eth_getCode',[address,block]);if(!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw Error();swapContracts[name]={address,code,codeHash:keccak256(code)};}
 for(const [name,address] of Object.entries(SAFE_CONTRACTS)){const code=await rpc('eth_getCode',[address,block]);if(!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code)!==SAFE_RUNTIME_HASHES[name])throw Error();safeContracts[name]={address,code,codeHash:keccak256(code)};}
 if((await rpc('eth_getBlockByNumber',[block,false]))?.hash!==header.hash)throw Error();
 if(process.argv.includes('--snapshot')){const directory=new URL('../outputs/',import.meta.url);await mkdir(directory,{recursive:true});await writeFile(new URL('permission-runtime.json',directory),JSON.stringify({chainId:4663,block,blockHash:header.hash,contracts:runtimes,swapContracts,safeContracts}));}
 console.log(JSON.stringify({chainId:4663,block,blockHash:header.hash,observedAt:new Date().toISOString(),contracts:evidence,safeRegistryFingerprintsMatched:true,implementationVerified:false,accountCompatible:false,grantInstalled:false,executionEnabled:false,transactionSent:false}));
}
main().catch(()=>{console.error('Permission infrastructure evidence unavailable. No transaction sent.');process.exitCode=1;});
