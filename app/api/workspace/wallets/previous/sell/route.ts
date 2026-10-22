import { env } from 'cloudflare:workers';
import { decodeFunctionResult, encodeFunctionData, formatUnits, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getOwnership } from '@/db/wallet-ownership';
import { reserveWalletAction } from '@/db/wallet-action-attempts';
import { assertTradingEnabled, tradingAdmission, tradingLimits } from '@/lib/trading-controls';
import { assertTradeAgreement } from '@/lib/trade-agreement';
import { D1DecisionLedger } from '@/db/ledger';
import { locateSafe, getCode, rpcCall, CHAIN_RPC } from '@/app/api/workspace/orders/live/_shared';
import { chainTransport } from '@/lib/chain-transport';
import { inspectTradeRoute } from '@/lib/chain-route';
import { ownerSaleTransaction } from '@/lib/owner-sale';
import { ownerSafeAbi } from '@/lib/previous-wallet-transfer';
import { SAFE_CONTRACTS, SAFE_RUNTIME_HASHES, MULTISEND } from '@/lib/safe-setup';
import { EXECUTION_CONTRACTS } from '@/lib/autonomy';
import { PERMIT2 } from '@/lib/install-flow';
import type { Mandate } from '@/lib/decision';

const proxyAbi = parseAbi(['function masterCopy() view returns (address)']);
const usdgAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const pinned = {
  router: '0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296',
  permit2: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
} as const;
const headers = { 'Cache-Control': 'no-store' };

async function rpc(method: string, params: unknown[], transport: typeof fetch) {
  const response = await transport(CHAIN_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), cache:'no-store', signal:AbortSignal.timeout(15000) });
  const body = await response.json() as {result?:string;error?:unknown};
  if (!response.ok || body.error || typeof body.result !== 'string') throw Error('Chain simulation unavailable. No transaction was sent.');
  return body.result;
}

// Sell one entire supported Stock Token balance to USDG in the same owner Safe.
// Only an unsigned, fully simulated transaction is returned. The owner's wallet signs.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:'Sign in first.'},{status:401,headers});
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({error:'Invalid request origin.'},{status:403,headers});
  if (!env.DB) return Response.json({error:'Workspace storage is unavailable.'},{status:503,headers});
  try {
    await assertTradeAgreement(env.DB, user.userId, request, env);
    const text = await request.text();
    if (text.length > 200) return Response.json({error:'Request too large.'},{status:413,headers});
    const body = JSON.parse(text) as {symbol?:unknown;wallet?:unknown;commit?:unknown;expectedQuantity?:unknown;expectedMinimumUsdgRaw?:unknown};
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    if (!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol) || !['current','previous'].includes(String(body.wallet)))
      return Response.json({error:'Choose a supported holding and wallet.'},{status:400,headers});
    const [current,ownership] = await Promise.all([new D1DecisionLedger(env.DB).getMandate(user.userId),getOwnership(env.DB,user.userId)]);
    if (!current || !ownership?.verifiedAt || !/^0x[0-9a-f]{40}$/i.test(ownership.address))
      return Response.json({error:'Verify your owner wallet first.'},{status:403,headers});
    const access = tradingAdmission(ownership.address,env);
    if (!access.ok) return Response.json({error:access.error},{status:403,headers});
    await assertTradingEnabled(env.DB, env);
    const previous = body.wallet === 'previous' ? await env.DB.prepare(`SELECT a.safe, a.mandate_version AS version, m.policy_json AS policy FROM active_modules a JOIN mandates m ON m.owner_ref=a.owner_ref AND m.version=a.mandate_version WHERE a.owner_ref=? AND a.mandate_version<? ORDER BY a.mandate_version DESC LIMIT 1`).bind(user.userId,current.version).first<{safe:string;version:number;policy:string}>() : null;
    if (body.wallet === 'previous' && (!previous || !/^0x[0-9a-f]{40}$/i.test(previous.safe))) throw Error('Earlier wallet unavailable.');
    const located = body.wallet === 'current' ? await locateSafe(env.DB,user.userId) : null;
    if (located && located.owner.toLowerCase() !== ownership.address.toLowerCase()) throw Error('Verified owner changed. Sale is blocked.');
    const safe = (located?.safe ?? previous!.safe) as Address;
    const owner = ownership.address as Address;
    const mandate = located?.mandate ?? JSON.parse(previous!.policy) as Mandate;
    if (!mandate.allowedSymbols.includes(symbol)) throw Error('This asset is not in the wallet mandate.');
    const transport = chainTransport(env.ALCHEMY_API_KEY);
    const [safeCode,multiCode,routerCode,permitCode] = await Promise.all([getCode(safe,transport),getCode(MULTISEND.address,transport),getCode(EXECUTION_CONTRACTS.router,transport),getCode(PERMIT2,transport)]);
    if (keccak256(safeCode as Hex).toLowerCase() !== SAFE_RUNTIME_HASHES.proxy ||
        keccak256(multiCode as Hex).toLowerCase() !== MULTISEND.runtimeHash ||
        keccak256(routerCode as Hex).toLowerCase() !== pinned.router ||
        keccak256(permitCode as Hex).toLowerCase() !== pinned.permit2) throw Error('Trading contract code changed. Sale is blocked.');
    const implementationRaw = await rpcCall(safe,encodeFunctionData({abi:proxyAbi,functionName:'masterCopy'}),'latest',transport);
    const implementation = decodeFunctionResult({abi:proxyAbi,functionName:'masterCopy',data:implementationRaw}) as Address;
    if (implementation.toLowerCase() !== SAFE_CONTRACTS.singleton.toLowerCase()) throw Error('Wallet implementation changed. Sale is blocked.');
    const [ownersRaw,thresholdRaw] = await Promise.all([rpcCall(safe,encodeFunctionData({abi:ownerSafeAbi,functionName:'getOwners'}),'latest',transport),rpcCall(safe,encodeFunctionData({abi:ownerSafeAbi,functionName:'getThreshold'}),'latest',transport)]);
    const owners = decodeFunctionResult({abi:ownerSafeAbi,functionName:'getOwners',data:ownersRaw}) as readonly Address[];
    const threshold = decodeFunctionResult({abi:ownerSafeAbi,functionName:'getThreshold',data:thresholdRaw}) as bigint;
    if (threshold !== 1n || owners.length !== 1 || owners[0].toLowerCase() !== owner.toLowerCase()) throw Error('Wallet owner changed. Sale is blocked.');
    // Read exact balance at the same route checkpoint; never infer a sale size from the UI.
    const assetList = await fetch('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if (!assetList.ok) throw Error('Official asset registry unavailable.');
    const {registry} = await import('@/lib/robinhood-chain');
    const asset = registry(await assetList.json()).find(entry=>entry.symbol===symbol);
    if (!asset || asset.status !== 'ASSET_STATUS_ACTIVE') throw Error('This Stock Token is not currently active.');
    const balanceRaw = await rpcCall(asset.contract,encodeFunctionData({abi:usdgAbi,functionName:'balanceOf',args:[safe]}),'latest',transport);
    const amount = decodeFunctionResult({abi:usdgAbi,functionName:'balanceOf',data:balanceRaw}) as bigint;
    if (amount <= 0n) throw Error('There are no tokens to sell in this wallet.');
    const route = await inspectTradeRoute(safe,symbol,formatUnits(amount,18),'sell',50,transport);
    if (BigInt(route.balanceRaw) !== amount || route.token.toLowerCase() !== asset.contract.toLowerCase()) throw Error('Balance changed. Review again.');
    if (!route.best || !route.minimumOutputRaw) throw Error('No live USDG sell quote is available for this holding.');
    if (Date.parse(route.expiresAt) <= Date.now()) throw Error('The quote expired. Review again.');
    // The quote is refreshed before signing. Give the owner time to inspect the
    // wallet popup; the fixed 0.5% minimum still protects a slower confirmation.
    const executionRoute = {...route, expiresAt:new Date(Date.now()+5*60*1000).toISOString()};
    const transaction = ownerSaleTransaction(executionRoute,owner);
    const simulated = await rpc('eth_call',[{from:transaction.from,to:transaction.to,value:transaction.value,data:transaction.data},'latest'],transport);
    if (simulated !== `0x${'0'.repeat(63)}1`) throw Error('The full wallet sale did not simulate successfully. No transaction was sent.');
    const gasRaw = await rpc('eth_estimateGas',[{from:transaction.from,to:transaction.to,value:transaction.value,data:transaction.data},'latest'],transport);
    if (!/^0x[0-9a-f]+$/i.test(gasRaw) || BigInt(gasRaw) <= 0n) throw Error('Network fee estimate unavailable. No transaction was sent.');
    if (Date.parse(route.expiresAt) <= Date.now()) throw Error('The quote expired during simulation. Review again.');
    const estimatedCents = Number((BigInt(route.best.outputRaw!)+9999n)/10000n);
    const limits = tradingLimits(env);
    if (limits.publicMode && estimatedCents > limits.maxOrderCents) throw Error(`This sale is above the $${(limits.maxOrderCents/100).toFixed(2)} public action limit. Change the cap or use a smaller holding.`);
    const exactTransaction = {from:transaction.from,to:transaction.to,value:transaction.value,data:transaction.data};
    let attemptId: string | null = null;
    if (body.commit === true) {
      if(body.expectedQuantity!==formatUnits(amount,18)||body.expectedMinimumUsdgRaw!==route.minimumOutputRaw)
        return Response.json({error:'The balance or minimum return changed. Review the new quote before signing.'},{status:409,headers});
      await assertTradingEnabled(env.DB, env);
      attemptId = await reserveWalletAction(env.DB,{owner:user.userId,ownerAddress:owner,safe,kind:'sell',symbol,quantity:formatUnits(amount,18),amountCents:limits.publicMode?estimatedCents:0,transaction:exactTransaction},limits.publicMode?limits.maxDailyCents:100_000_000);
      if (!attemptId) return Response.json({error:'This sale is already prepared or the daily action limit is spent. Check your saved attempt before trying again.'},{status:409,headers});
    }
    return Response.json({symbol,safe,owner,quantity:formatUnits(amount,18),estimatedUsdg:formatUnits(BigInt(route.best.outputRaw!),6),minimumUsdg:formatUnits(BigInt(route.minimumOutputRaw),6),minimumUsdgRaw:route.minimumOutputRaw,gasEstimate:BigInt(gasRaw).toString(),expiresAt:executionRoute.expiresAt,transaction:exactTransaction,attemptId,simulated:true},{headers});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Sale review unavailable. No transaction was sent.'},{status:409,headers});
  }
}
