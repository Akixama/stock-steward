import {readFile} from 'node:fs/promises';
import {inspectRoute} from '../lib/chain-route.ts';
import {routePrerequisites} from '../lib/route-prerequisites.ts';
import {simulateRouter} from '../lib/router-simulation.ts';
import {chainTransport} from '../lib/chain-transport.ts';
// Read-only mainnet probe. No signing, state overrides, permissions or transaction submission.
async function main(){
 let key=process.env.ALCHEMY_API_KEY?.trim();
 if(!key){try{key=JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json',import.meta.url),'utf8')).apiKey?.trim();}catch{throw Error('Private RPC configuration unavailable.');}}
 if(!key||!/^[A-Za-z0-9_-]+$/.test(key))throw Error('Private RPC configuration unavailable.');
 const transport=chainTransport(key);
 const route=await inspectRoute('0x000000000000000000000000000000000000dead','AAPL','1',50,transport);
 const prerequisites=await routePrerequisites(route,null,transport);
 const simulation=await simulateRouter(route,null,prerequisites?.routerCodeHash??null,transport);
 console.log(JSON.stringify({chain:4663,block:route.block,observedAt:simulation.observedAt,quoted:!!route.best,simulation:simulation.state,revertSelector:simulation.revertSelector,estimatedExecutionGas:simulation.estimatedExecutionGas,delegatedAccountVerified:false,executionEnabled:false,transactionSent:false}));
 if(simulation.state==='unavailable'||simulation.state==='expired')process.exitCode=1;
}
main().catch(()=>{console.error('Read-only route simulation unavailable. No transaction sent.');process.exitCode=1;});
