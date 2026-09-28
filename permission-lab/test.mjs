import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {reserveAttempt,beginAttempt,recordSubmission,settleAttempt,getAttempt} from '../db/execution-attempts.ts';
import {routerCandidate} from '../lib/router-candidate.ts';
import {reviewSetupFees} from '../lib/setup-fees.ts';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import ganache from 'ganache';import solc from 'solc';
import {createWalletClient,createPublicClient,custom,encodeAbiParameters,encodeFunctionData,decodeFunctionData,decodeAbiParameters,decodeEventLog,parseAbiParameters,parseAbi,keccak256,pad,toHex} from 'viem';
import {compileRolesPolicy,approvedRouterCall,encodeRolesExecution,rolesAbi,ROLES_CONTRACTS,ROLES_RUNTIME_HASHES,rolesDeploymentCall,rolesFactoryAbi} from '../lib/roles-permission.ts';
import {EXECUTION_CONTRACTS} from '../lib/autonomy.ts';import {VENUE,poolIdentity} from '../lib/chain-route.ts';
import {simulateRolesOperation} from '../lib/roles-operation.ts';
import {reconcileRolesFill} from '../lib/chain-fill-proof.ts';
import {inspectRolesInstallation} from '../lib/roles-installation.ts';
import {safeSetupPlan,safeFactoryAbi,SAFE_CONTRACTS,SAFE_RUNTIME_HASHES} from '../lib/safe-setup.ts';

// Isolated in-memory EVM. No RPC forwarding, mainnet transaction or real wallet key.
const snapshot=JSON.parse(await readFile(new URL('../outputs/permission-runtime.json',import.meta.url),'utf8'));
const pinned=ROLES_RUNTIME_HASHES;
assert.equal(snapshot.chainId,4663);
for(const [name,hash] of Object.entries(pinned)){assert.equal(snapshot.contracts[name].address.toLowerCase(),ROLES_CONTRACTS[name].toLowerCase());assert.equal(keccak256(snapshot.contracts[name].code),hash);}
const actualRouter=process.argv.includes('--actual-router');
let provider;
if(actualRouter){
 const {createHardhatNetworkProvider}=await import('hardhat/internal/hardhat-network/provider/provider.js');
 const backend=await createHardhatNetworkProvider({hardfork:'cancun',chainId:4663,networkId:4663,blockGasLimit:30000000,minGasPrice:0n,automine:true,intervalMining:0,mempoolOrder:'fifo',chains:new Map(),genesisAccounts:[0,1,2].map(i=>({privateKey:keccak256(toHex('PUBLIC LOCAL FIXTURE ONLY '+i)),balance:'1000000000000000000000'})),allowUnlimitedContractSize:false,throwOnTransactionFailures:false,throwOnCallFailures:true,allowBlocksWithSameTimestamp:false,initialBaseFeePerGas:1000000000,initialDate:new Date('2026-09-27T12:00:00Z'),enableTransientStorage:true,enableRip7212:false},{enabled:false});
 provider={request:async({method,params})=>backend.request({method:method==='evm_setAccountCode'?'hardhat_setCode':method==='evm_setTime'?'evm_setNextBlockTimestamp':method,params:method==='evm_setTime'?[Math.floor(params[0]/1000)]:params}),disconnect:async()=>{await backend.request({method:'hardhat_reset',params:[]});}};
}else provider=ganache.provider({logging:{quiet:true},chain:{chainId:4663,time:new Date('2026-09-27T12:00:00Z'),hardfork:'shanghai'},wallet:{totalAccounts:3},miner:{timestampIncrement:1}});
const chain={id:4663,name:'Isolated permission lab',nativeCurrency:{name:'Fixture ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[]}}};
const wallet=createWalletClient({chain,transport:custom(provider)}),publicClient=createPublicClient({chain,transport:custom(provider)});
const [owner,session,outsider]=await wallet.getAddresses();let scenarios=0;
const safeArtifact=JSON.parse(await readFile(new URL('node_modules/@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json',import.meta.url),'utf8'));
const proxyArtifact=JSON.parse(await readFile(new URL('node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json',import.meta.url),'utf8'));
const ZERO='0x0000000000000000000000000000000000000000';
const fixture=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Fixtures.sol':{content:await readFile(new URL('Fixtures.sol',import.meta.url),'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
if(fixture.errors?.some(e=>e.severity==='error'))throw Error('Fixture compilation failed');
const artifacts=fixture.contracts['Fixtures.sol'];
const receipt=async hash=>{const r=await publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
const tx=async(to,data,account=owner)=>receipt(await wallet.sendTransaction({account,to,data,gas:12000000n}));
const deploy=async(abi,bytecode,args=[])=>{const r=await receipt(await wallet.deployContract({account:owner,abi,bytecode,args,gas:12000000n}));assert.ok(r.contractAddress);return r.contractAddress;};
const write=async(address,abi,functionName,args=[],account=owner)=>tx(address,encodeFunctionData({abi,functionName,args}),account);
const read=async(address,abi,functionName,args=[])=>publicClient.readContract({address,abi,functionName,args});
try{
 for(const record of Object.values(snapshot.contracts))await provider.request({method:'evm_setAccountCode',params:[record.address,record.code]});
 for(const [name,record] of Object.entries(snapshot.safeContracts)){assert.equal(keccak256(record.code),SAFE_RUNTIME_HASHES[name]);await provider.request({method:'evm_setAccountCode',params:[record.address,record.code]});}
 const creationCode=await read(SAFE_CONTRACTS.factory,safeFactoryAbi,'proxyCreationCode');
 const safePlan=safeSetupPlan(owner,'0x'+'8'.repeat(64),creationCode);
 const safeCreation=await tx(safePlan.call.to,safePlan.call.data);
 const safeLog=safeCreation.logs.find(l=>l.address.toLowerCase()===SAFE_CONTRACTS.factory.toLowerCase());assert.ok(safeLog);
 const safe=decodeEventLog({abi:safeFactoryAbi,data:safeLog.data,topics:safeLog.topics}).args.proxy;
 assert.equal(safe.toLowerCase(),safePlan.account.toLowerCase());scenarios++;
 const signature=(pad(owner,{size:32})+'0'.repeat(64)+'01'); // Safe's owner-sent prevalidated signature; fixture owner only.
 async function ownerCall(to,data){return write(safe,safeArtifact.abi,'execTransaction',[to,0n,data,0,0n,0n,0n,ZERO,ZERO,signature]);}
 const deployment=rolesDeploymentCall(safe,'0x'+'9'.repeat(64));
 const moduleCreation=await ownerCall(deployment.to,deployment.data);
 const log=moduleCreation.logs.find(l=>l.address.toLowerCase()===ROLES_CONTRACTS.factory.toLowerCase());assert.ok(log);
 const module=decodeEventLog({abi:rolesFactoryAbi,data:log.data,topics:log.topics}).args.proxy;
 const enableReceipt=await ownerCall(safe,encodeFunctionData({abi:safeArtifact.abi,functionName:'enableModule',args:[module]}));let installGas=enableReceipt.gasUsed,approvalGas=0n;
 assert.equal((await read(module,rolesAbi,'owner')).toLowerCase(),safe.toLowerCase());
 assert.equal(await read(safe,safeArtifact.abi,'isModuleEnabled',[module]),true);
 await provider.request({method:'evm_setAccountCode',params:[VENUE.settlement,'0x'+artifacts.FixtureToken.evm.deployedBytecode.object]});
 if(actualRouter){for(const record of Object.values(snapshot.swapContracts)){assert.equal(keccak256(record.code),record.codeHash);await provider.request({method:'evm_setAccountCode',params:[record.address,record.code]});}}
 else await provider.request({method:'evm_setAccountCode',params:[EXECUTION_CONTRACTS.router,'0x'+artifacts.FixtureRouter.evm.deployedBytecode.object]});
 const token=await deploy(artifacts.FixtureToken.abi,'0x'+artifacts.FixtureToken.evm.bytecode.object);
 const token2=await deploy(artifacts.FixtureToken.abi,'0x'+artifacts.FixtureToken.evm.bytecode.object);
 const startsAt=Math.floor(Number((await publicClient.getBlock()).timestamp)/86400)*86400;
 const policy={account:safe,module,session,grantId:'0x'+'1'.repeat(64),routerCodeHash:actualRouter?snapshot.swapContracts.router.codeHash:keccak256('0x'+artifacts.FixtureRouter.evm.deployedBytecode.object),startsAt,expiresAt:startsAt+2*86400,inputRaw:'1000000',dailyRaw:'2000000',totalRaw:'3000000',outputs:[{token,fee:3000,tickSpacing:60,minimumOutputRaw:'123'},{token:token2,fee:500,tickSpacing:10,minimumOutputRaw:'456'}]};
 const plan=compileRolesPolicy(policy);assert.equal(plan.installationEnabled,false);
 for(const call of plan.calls){try{await publicClient.call({account:safe,to:call.to,data:call.data});}catch(e){console.error('Configuration rejected',call.data.slice(0,10),e.walk?.(x=>typeof x.data==='string')?.data??e.shortMessage);throw Error('Permission configuration failed');}installGas+=(await ownerCall(call.to,call.data)).gasUsed;}
 const localFetch=async(_url,init)=>{const {id,method,params}=JSON.parse(init.body);assert.ok(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_getStorageAt','eth_call','eth_getTransactionReceipt','eth_getLogs','eth_estimateGas','eth_getTransactionByHash'].includes(method));try{return Response.json({jsonrpc:'2.0',id,result:await provider.request({method,params})});}catch{return Response.json({jsonrpc:'2.0',id,error:{code:-32000,message:'Local read unavailable'}});}};
 const installed=await inspectRolesInstallation(policy,moduleCreation.transactionHash,localFetch);
 assert.equal(installed.state,'verified_policy_state',installed.why);assert.equal(installed.executionEnabled,false);assert.equal(installed.walletOwnershipVerified,false);scenarios++;
 const snapshotState=await provider.request({method:'evm_snapshot',params:[]});
 async function rejectStateChange(change){const saved=await provider.request({method:'evm_snapshot',params:[]});await change();const checked=await inspectRolesInstallation(policy,moduleCreation.transactionHash,localFetch);assert.equal(checked.state,'blocked');assert.equal(checked.executionEnabled,false);scenarios++;assert.equal(await provider.request({method:'evm_revert',params:[saved]}),true);}
 await rejectStateChange(()=>ownerCall(module,encodeFunctionData({abi:rolesAbi,functionName:'allowTarget',args:[plan.roleKey,EXECUTION_CONTRACTS.router,0]})));
 await rejectStateChange(()=>ownerCall(module,encodeFunctionData({abi:rolesAbi,functionName:'allowFunction',args:[plan.roleKey,EXECUTION_CONTRACTS.router,'0x3593564c',0]})));
 await rejectStateChange(()=>ownerCall(module,encodeFunctionData({abi:rolesAbi,functionName:'assignRoles',args:[session,['0x'+'f'.repeat(64)],[true]]})));
 await rejectStateChange(()=>ownerCall(module,encodeFunctionData({abi:rolesAbi,functionName:'setAllowance',args:[plan.dailyKey,3n,3n,3n,86400n,BigInt(startsAt)]})));
 await rejectStateChange(()=>ownerCall(plan.revocation.to,plan.revocation.data));
 await rejectStateChange(()=>ownerCall(safe,encodeFunctionData({abi:safeArtifact.abi,functionName:'enableModule',args:[session]})));
 const missingHistory=async(url,init)=>{const request=JSON.parse(init.body);return request.method==='eth_getLogs'?Response.json({jsonrpc:'2.0',id:request.id,result:[]}):localFetch(url,init);};
 assert.equal((await inspectRolesInstallation(policy,moduleCreation.transactionHash,missingHistory)).state,'blocked');scenarios++;
 assert.equal((await inspectRolesInstallation({...policy,routerCodeHash:'0x'+'f'.repeat(64)},moduleCreation.transactionHash,localFetch)).state,'blocked');scenarios++;
 assert.equal(await provider.request({method:'evm_revert',params:[snapshotState]}),true);
 await write(VENUE.settlement,artifacts.FixtureToken.abi,'mint',[safe,10000000n]);
 const permit2Abi=parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
 async function setFailure(fail){if(actualRouter)approvalGas+=(await ownerCall(EXECUTION_CONTRACTS.permit2,encodeFunctionData({abi:permit2Abi,functionName:'approve',args:[VENUE.settlement,EXECUTION_CONTRACTS.router,fail?0n:10000000n,startsAt+3*86400]}))).gasUsed;else await write(EXECUTION_CONTRACTS.router,artifacts.FixtureRouter.abi,'setFail',[fail]);}
 if(actualRouter){
  approvalGas+=(await ownerCall(VENUE.settlement,encodeFunctionData({abi:artifacts.FixtureToken.abi,functionName:'approve',args:[EXECUTION_CONTRACTS.permit2,10000000n]}))).gasUsed;await setFailure(false);
  const lp=await deploy(artifacts.FixtureLiquidityProvider.abi,'0x'+artifacts.FixtureLiquidityProvider.evm.bytecode.object,[VENUE.manager]);
  const managerAbi=parseAbi(['function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24)']);
  for(const currency of [VENUE.settlement,token,token2])await write(currency,artifacts.FixtureToken.abi,'mint',[lp,10n**18n]);
  for(const output of policy.outputs){const {key}=poolIdentity(output.token,output.fee,output.tickSpacing);await write(VENUE.manager,managerAbi,'initialize',[key,2n**96n]);await write(lp,artifacts.FixtureLiquidityProvider.abi,'add',[key,-2*output.tickSpacing,2*output.tickSpacing]);}
 }else await ownerCall(VENUE.settlement,encodeFunctionData({abi:artifacts.FixtureToken.abi,functionName:'approve',args:[EXECUTION_CONTRACTS.router,10000000n]}));
 const budget=async key=>(await read(module,rolesAbi,'allowances',[key]))[3];
 const makeCall=async(t=token)=>approvedRouterCall(policy,t,Number((await publicClient.getBlock()).timestamp)+25);
 const execute=async(c,who=session)=>{const envelope=encodeRolesExecution(module,plan.roleKey,c);try{await publicClient.call({account:who,to:envelope.to,data:envelope.data});}catch(e){console.error('Execution rejected',e.walk?.(x=>typeof x.data==='string')?.data??e.shortMessage);throw Error('Expected bounded execution failed');}return tx(envelope.to,envelope.data,who);};
 async function denied(c,{sender=session,to=c.to,value=0n,operation=0,role=plan.roleKey}={}){
  const data=encodeFunctionData({abi:rolesAbi,functionName:'execTransactionWithRole',args:[to,value,c.data,operation,role,true]});
  const before=[await budget(plan.dailyKey),await budget(plan.totalKey),await read(VENUE.settlement,artifacts.FixtureToken.abi,'balanceOf',[safe])];
  await assert.rejects(()=>publicClient.call({account:sender,to:module,data}));
  assert.deepEqual([await budget(plan.dailyKey),await budget(plan.totalKey),await read(VENUE.settlement,artifacts.FixtureToken.abi,'balanceOf',[safe])],before);scenarios++;
 }
 if(actualRouter){
  const saved=await provider.request({method:'evm_snapshot',params:[]});
  const header=await publicClient.getBlock(),time=Number(header.timestamp)*1000;
  const route={id:crypto.randomUUID(),chainId:4663,address:safe,symbol:'FIXTURE',token,settlement:VENUE.settlement,input:'1',inputRaw:policy.inputRaw,settlementDecimals:6,block:toHex(header.number),blockHash:header.hash,blockAt:new Date(time).toISOString(),observedAt:new Date(time).toISOString(),expiresAt:new Date(time+25000).toISOString(),balanceRaw:'10000000',slippageBps:50,probes:[],best:{fee:3000,tickSpacing:60,poolId:poolIdentity(token,3000,60).poolId,state:'quoted',outputRaw:'123',reason:'Isolated fixture only'},minimumOutputRaw:'123',executionEnabled:false,coverage:'Isolated fixture',blockers:[]};
  const simulation=await simulateRolesOperation(route,1,policy,moduleCreation.transactionHash,localFetch,time);
  assert.equal(simulation.state,'simulated',JSON.stringify(simulation));assert.ok(BigInt(simulation.estimatedGas)>0n);assert.equal(simulation.executionEnabled,false);scenarios++;
  const expired=await simulateRolesOperation(route,1,policy,moduleCreation.transactionHash,localFetch,time+30000);assert.equal(expired.state,'blocked');scenarios++;
  const falseCall=async(url,init)=>{const q=JSON.parse(init.body);if(q.method==='eth_call'&&q.params[0].from===session)return Response.json({jsonrpc:'2.0',id:q.id,result:'0x'+'0'.repeat(64)});return localFetch(url,init);};
  assert.equal((await simulateRolesOperation(route,1,policy,moduleCreation.transactionHash,falseCall,time)).state,'blocked');scenarios++;
  const completed=await execute(approvedRouterCall(policy,token,Math.floor(Date.parse(route.expiresAt)/1000)));
  const proof=await reconcileRolesFill(route,1,completed.transactionHash,policy,moduleCreation.transactionHash,localFetch);
  assert.equal(proof.outcome,'verified_fill',JSON.stringify(proof));assert.equal(proof.delegatedAccountVerified,true);assert.equal(proof.actualInputRaw,'1000000');scenarios++;
  const forged=async(url,init)=>{const q=JSON.parse(init.body);const r=await localFetch(url,init);if(q.method!=='eth_getTransactionByHash')return r;const b=await r.json();return Response.json({...b,result:{...b.result,from:outsider}});};
  assert.equal((await reconcileRolesFill(route,1,completed.transactionHash,policy,moduleCreation.transactionHash,forged)).outcome,'unknown');scenarios++;
  // Reconcile the same actual fixture transaction through the durable attempt ledger.
  const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE autonomy_spends(owner_ref TEXT,address TEXT,execution_day TEXT,intent_id TEXT,amount_cents INTEGER,state TEXT,PRIMARY KEY(owner_ref,address,intent_id));');sql.exec(await readFile(new URL('../drizzle/0010_flimsy_paibok.sql',import.meta.url),'utf8'));
  const db={prepare(query){return {bind(...values){return {async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},async first(){return sql.prepare(query).get(...values)??null;}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const st of statements)results.push(await st.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  try{const candidate=routerCandidate(route,1),attempt={owner:'isolated-fixture-owner',address:safe.toLowerCase(),intentDigest:candidate.intentDigest,mandateVersion:1,day:new Date(time).toISOString().slice(0,10),amountCents:100,dailyCapCents:200,candidate,route,routerCodeHash:policy.routerCodeHash,permission:{policy,creationTx:moduleCreation.transactionHash}},date=new Date(time);
   assert.equal(await reserveAttempt(db,attempt,date),true);assert.equal(await reserveAttempt(db,attempt,date),false);assert.equal(await beginAttempt(db,attempt.owner,attempt.intentDigest,1,date),true);assert.equal(await beginAttempt(db,attempt.owner,attempt.intentDigest,1,date),false);assert.equal(await recordSubmission(db,attempt.owner,attempt.intentDigest,completed.transactionHash,date),true);assert.equal(await settleAttempt(db,attempt.owner,attempt.intentDigest,proof,date),true);assert.equal((await getAttempt(db,attempt.owner,attempt.intentDigest)).state,'confirmed');assert.equal(await settleAttempt(db,attempt.owner,attempt.intentDigest,proof,date),false);scenarios++;
  }finally{sql.close();}
  const revoked=await ownerCall(plan.revocation.to,plan.revocation.data);
  const fee=reviewSetupFees({source:'isolated-fixture',chainId:4663,observedAt:time,priceVerified:true,ethUpperMicroUsd:'3000000000',maxFeePerGasWei:'1000000000',components:[['wallet_creation',safeCreation.gasUsed],['module_creation',moduleCreation.gasUsed],['permission_installation',installGas],['token_approvals',approvalGas],['execution',completed.gasUsed],['revocation',revoked.gasUsed]].map(([name,gas])=>({name,gas:gas.toString(),dataFeeWei:'0',providerFeeWei:'0'}))},2000,time);
  assert.equal(fee.state,'within_cap');assert.equal(fee.liveQuote,false);assert.equal(fee.executionEnabled,false);scenarios++;
  assert.equal(await provider.request({method:'evm_revert',params:[saved]}),true);
 }
 const outer=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
 const inner=parseAbiParameters('bytes actions,bytes[] params');
 const c=await makeCall();
 const [commands,inputs,deadline]=decodeFunctionData({abi:outer,data:c.data}).args;
 const [actions,params]=decodeAbiParameters(inner,inputs[0]);
 const changed=(cmd=commands,act=actions,ps=params,ins=null,end=deadline)=>({...c,data:encodeFunctionData({abi:outer,functionName:'execute',args:[cmd,ins??[encodeAbiParameters(inner,[act,ps])],end]})});
 await denied(c,{sender:outsider});await denied(c,{to:token});await denied(c,{value:1n});await denied(c,{operation:1});await denied(c,{role:'0x'+'0'.repeat(64)});
 for(const cmd of ['0x90','0x1010','0x00'])await denied(changed(cmd));
 for(const act of ['0x060c0e','0x060c0f0f'])await denied(changed(commands,act));
 await denied(changed(commands,actions,[...params,params[2]]));
 await denied(changed(commands,actions,params,[...inputs,inputs[0]]));
 await denied(changed(commands,actions,params,null,BigInt(policy.expiresAt)));
 for(const index of [0,1,2]){const copy=[...params];copy[index]=copy[index].slice(0,-2)+'ff';await denied(changed(commands,actions,copy));}
 await denied({...c,data:encodeFunctionData({abi:artifacts.FixtureToken.abi,functionName:'approve',args:[outsider,2n**256n-1n]})},{to:VENUE.settlement});
 await denied({...c,data:encodeFunctionData({abi:rolesAbi,functionName:'assignRoles',args:[outsider,[plan.roleKey],[true]]})},{to:module});
 const initial=await budget(plan.totalKey);
 await setFailure(true);await denied(await makeCall());
 const failedEnvelope=encodeRolesExecution(module,plan.roleKey,await makeCall());
 const failed=await publicClient.waitForTransactionReceipt({hash:await wallet.sendTransaction({account:session,to:failedEnvelope.to,data:failedEnvelope.data,gas:12000000n})});
 assert.equal(failed.status,'reverted');assert.equal(await budget(plan.dailyKey),2n);scenarios++;
 assert.equal(await budget(plan.totalKey),initial);
 await setFailure(false);
 await execute(await makeCall());scenarios++;
 assert.equal(await budget(plan.dailyKey),1n);assert.equal(await budget(plan.totalKey),2n);
 const received=await read(token,artifacts.FixtureToken.abi,'balanceOf',[safe]);assert.ok(received>=123n);if(!actualRouter)assert.equal(received,123n);
 if(!actualRouter)assert.equal((await read(EXECUTION_CONTRACTS.router,artifacts.FixtureRouter.abi,'lastCaller')).toLowerCase(),safe.toLowerCase());
 assert.equal(await read(token,artifacts.FixtureToken.abi,'balanceOf',[session]),0n);
 await execute(await makeCall(token2));scenarios++;
 assert.equal(await budget(plan.dailyKey),0n);assert.equal(await budget(plan.totalKey),1n);
 await denied(await makeCall());
 await provider.request({method:'evm_setTime',params:[(startsAt+86400+60)*1000]});await provider.request({method:'evm_mine',params:[]});
 await execute(await makeCall());scenarios++;
 assert.equal(await budget(plan.dailyKey),1n);assert.equal(await budget(plan.totalKey),0n);
 await denied(await makeCall());
 // Reinstall a fresh, independent role only via owner. Old role remains exhausted.
 const freshPolicy={...policy,grantId:'0x'+'2'.repeat(64)};const freshPlan=compileRolesPolicy(freshPolicy);
 for(const call of freshPlan.calls)await ownerCall(call.to,call.data);
 const freshCall=approvedRouterCall(freshPolicy,token,Number((await publicClient.getBlock()).timestamp)+25);
 await ownerCall(freshPlan.revocation.to,freshPlan.revocation.data);
 await assert.rejects(()=>publicClient.call({account:session,to:module,data:encodeRolesExecution(module,freshPlan.roleKey,freshCall).data}));scenarios++;
 // Re-enable locally, then prove the actual router rejects all deadlines after policy expiry.
 await ownerCall(module,encodeFunctionData({abi:rolesAbi,functionName:'assignRoles',args:[session,[freshPlan.roleKey],[true]]}));
 await provider.request({method:'evm_setTime',params:[(policy.expiresAt+1)*1000]});await provider.request({method:'evm_mine',params:[]});
 await assert.rejects(()=>publicClient.call({account:session,to:module,data:encodeRolesExecution(module,freshPlan.roleKey,approvedRouterCall(freshPolicy,token,policy.expiresAt-1)).data}));scenarios++;
 const result={scenarios,permissionRuntimeSource:'Robinhood mainnet bytecode snapshot',block:snapshot.block,safeVersion:'1.4.1 canonical singleton and factory runtime',environment:'isolated local EVM',router:actualRouter?'mainnet Universal Router, Permit2 and PoolManager runtime; local fixture pools':'test double, not a real Uniswap swap',assets:'local fixtures only',liveWalletCompatible:false,mainnetGrantInstalled:false,mainnetExecutionEnabled:false,realMoneySpent:false};
 await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL(actualRouter?'../outputs/permission-swap-lab-result.json':'../outputs/permission-lab-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await provider.disconnect();}

