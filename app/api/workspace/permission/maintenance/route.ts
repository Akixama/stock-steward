import { env } from 'cloudflare:workers';
import { decodeFunctionResult, encodeFunctionData, formatEther, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { buildPolicyBase, locateSafe, rpcCall, CHAIN_RPC } from '@/app/api/workspace/orders/live/_shared';
import { getActiveModule, saveActiveModule } from '@/db/active-modules';
import { latestMaintenance, maintenanceById, recordMaintenanceHash, reserveMaintenance, settleMaintenance, unresolvedMaintenance,
  type MaintenanceAttempt, type MaintenanceKind } from '@/db/permission-maintenance';
import { withRoleMembership } from '@/lib/role-membership';
import { verifyPolicyReadback } from '@/lib/live-order';
import { compileRolesPolicy, type RolesPolicy } from '@/lib/roles-permission';
import { approvalAddresses, decodeFundingReadback, fundingCalls, fundingRemainingValid, maintenanceEligibility, maintenanceTransaction,
  maintenanceReceiptProof, maintenanceEarlyProof, renewalVerified, revocationVerified,
  type MaintenanceChainTransaction, type MaintenanceReceipt } from '@/lib/permission-maintenance';
import { MULTISEND } from '@/lib/safe-setup';
import { assertTradingEnabled, tradingAdmission } from '@/lib/trading-controls';
import { chainReadBatch } from '@/lib/chain-read-batch';
import { earlyConfirmationCount } from '@/lib/confirmation-status';

const adminAbi = parseAbi(['function owner() view returns (address)','function avatar() view returns (address)','function target() view returns (address)']);

async function rpc(method: string, params: unknown[], transport: typeof fetch) {
  const response = await transport(CHAIN_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (!response.ok || body.error || body.result === undefined) throw Error('Chain read unavailable. The attempt remains unresolved.');
  return body.result;
}
async function funding(safe: Address, transport: typeof fetch) {
  const [token, permit] = fundingCalls(safe);
  const [a,b] = await Promise.all([rpcCall(token.to,token.data,'latest',transport),rpcCall(permit.to,permit.data,'latest',transport)]);
  return decodeFundingReadback(a,b);
}
async function proveModule(safe: Address, module: Address, transport: typeof fetch) {
  const names=['owner','avatar','target'] as const;
  const rows=await chainReadBatch(CHAIN_RPC,[
    {method:'eth_getCode',params:[safe,'latest']},
    {method:'eth_getCode',params:[module,'latest']},
    ...names.map(name=>({method:'eth_call',params:[{to:module,data:encodeFunctionData({abi:adminAbi,functionName:name})},'latest']})),
  ],transport);
  if(rows.slice(0,2).some(code=>typeof code!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(code)||code==='0x'))
    throw Error('Existing wallet or module is missing.');
  for (const [index,name] of names.entries()) {
    const raw=rows[index+2] as Hex;
    if (String(decodeFunctionResult({abi:adminAbi,functionName:name,data:raw})).toLowerCase() !== safe.toLowerCase())
      throw Error('The recorded module does not belong to this Steward wallet.');
  }
}
async function pinnedMultisend(transport: typeof fetch) {
  const code = await rpc('eth_getCode',[MULTISEND.address,'latest'],transport);
  if (typeof code !== 'string' || code === '0x' || keccak256(code as Hex).toLowerCase() !== MULTISEND.runtimeHash.toLowerCase())
    throw Error('The checked batch helper is unavailable. No wallet request was made.');
}
async function currentContext(db: D1Database, owner: string) {
  const located = await locateSafe(db,owner);
  const saved = await getActiveModule(db,owner,located.mandate.version);
  if (!saved || saved.safe.toLowerCase() !== located.safe.toLowerCase() || !saved.outputs)
    throw Error('A verified permission with its exact stock scope is required. No setup was offered.');
  await proveModule(located.safe,saved.module as Address,located.transport);
  const built = await buildPolicyBase(located,saved.outputs.map(output=>({...output,token:output.token as Address})),saved);
  const policy = {account:located.safe,module:saved.module as Address,...built.base} as RolesPolicy;
  return {located,saved,policy};
}
async function readChecks(policy: RolesPolicy, transport: typeof fetch) {
  const compiled = compileRolesPolicy(policy);
  const call = withRoleMembership((to:string,data:Hex,block:string)=>rpcCall(to,data,block,transport),transport);
  return verifyPolicyReadback(policy,compiled,call,'latest');
}
// Shared with the read-only background worker. This function never signs or sends.
export async function reconcileMaintenanceAttempt(db: D1Database, attempt: MaintenanceAttempt, transport: typeof fetch) {
  if (!attempt.hash || !['submitted','unknown'].includes(attempt.state)) return attempt;
  try {
    const [receipt,transaction,finalized] = await Promise.all([
      rpc('eth_getTransactionReceipt',[attempt.hash],transport) as Promise<MaintenanceReceipt|null>,
      rpc('eth_getTransactionByHash',[attempt.hash],transport) as Promise<MaintenanceChainTransaction|null>,
      rpc('eth_getBlockByNumber',['finalized',false],transport) as Promise<{number?:string}|null>,
    ]);
    const proof=maintenanceReceiptProof(attempt,receipt,transaction,finalized?.number??null);
    if(proof==='unknown'){
      if(!receipt?.blockNumber||!receipt.blockHash)return attempt;
      const [head,block]=await Promise.all([rpc('eth_blockNumber',[],transport) as Promise<string>,
        rpc('eth_getBlockByNumber',[receipt.blockNumber,false],transport) as Promise<{hash?:string}|null>]);
      const included=maintenanceEarlyProof(attempt,receipt,transaction,block?.hash??null,head,earlyConfirmationCount((env as unknown as Record<string,unknown>).EARLY_CONFIRMATION_BLOCKS));
      if(included==='reorged'||included==='reverted')return {...attempt,confirmation:included};
      if(included!=='confirmed')return attempt;
      const readback=await funding(attempt.safe as Address,transport);
      const checks=await readChecks(attempt.policy,transport);
      const verified=attempt.kind==='renew'
        ?renewalVerified(attempt.policy,readback,checks.checks)
        :revocationVerified(checks.checks.find(check=>check.label==='Session membership')?.observed==='active',readback);
      return verified?{...attempt,confirmation:'confirmed' as const}:attempt;
    }
    if (proof==='reverted') {
      await settleMaintenance(db,attempt.owner,attempt.id,'reverted');
      return {...attempt,state:'reverted' as const};
    }
    const readback = await funding(attempt.safe as Address,transport);
    if (attempt.kind==='renew') {
      const checks = await readChecks(attempt.policy,transport);
      if (!renewalVerified(attempt.policy,readback,checks.checks)) return attempt;
      await saveActiveModule(db,attempt.owner,attempt.mandateVersion,attempt.safe,attempt.module,
        attempt.policy.outputs.map(output=>({...output,token:output.token.toLowerCase()})),new Date(),
        {startsAt:attempt.startsAt,expiresAt:attempt.expiresAt});
    } else {
      const checks = await readChecks(attempt.policy,transport);
      const membership = checks.checks.find(check=>check.label==='Session membership');
      if (!revocationVerified(membership?.observed==='active',readback) || membership?.observed!=='revoked') return attempt;
    }
    await settleMaintenance(db,attempt.owner,attempt.id,'confirmed');
    return {...attempt,state:'confirmed' as const};
  } catch { return attempt; }
}

function publicAttempt(attempt: (MaintenanceAttempt&{confirmation?:'confirmed'|'reverted'|'reorged'})|null) {
  return attempt && {id:attempt.id,kind:attempt.kind,state:attempt.state,hash:attempt.hash,
    safe:attempt.safe,createdAt:attempt.createdAt,expiresAt:attempt.expiresAt,confirmation:attempt.confirmation??null};
}

export async function GET() {
  try {
    const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401});
    if(!env.DB)return Response.json({error:'Workspace storage is unavailable.'},{status:503});
    const initial=await currentContext(env.DB,user.userId);
    const {located,saved}=initial;
    const transport=located.transport;
    const pending=await unresolvedMaintenance(env.DB,user.userId,located.safe);
    const attempt=pending?await reconcileMaintenanceAttempt(env.DB,pending,transport):await latestMaintenance(env.DB,user.userId,located.safe);
    const currentContextValue=attempt?.state==='confirmed'&&attempt.kind==='renew'
      ? await currentContext(env.DB,user.userId) : initial;
    const current=currentContextValue.saved;
    const approvals=await funding(located.safe,transport);
    const eligible=maintenanceEligibility(current.expiresAt);
    const checks=await readChecks(currentContextValue.policy,transport);
    const permissionActive=checks.allOk&&fundingRemainingValid(currentContextValue.policy,approvals)
      &&eligible.state!=='expired';
    return Response.json({safe:located.safe,module:saved.module,ownerAddress:located.owner,mandateVersion:saved.mandateVersion,
      expiry:current.expiresAt,eligibility:eligible,permissionActive,checks:checks.checks,
      approvals:{tokenRaw:String(approvals.tokenRaw),
      permitRaw:String(approvals.permitRaw),permitExpiresAt:approvals.permitExpiresAt},
      attempt:publicAttempt(attempt),spenders:approvalAddresses},
      {headers:{'Cache-Control':'no-store'}});
  } catch(error){return Response.json({error:error instanceof Error?error.message:'Permission status unavailable.'},{status:409});}
}

export async function POST(request: Request) {
  try {
    const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401});
    if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
    if(!env.DB)return Response.json({error:'Workspace storage is unavailable.'},{status:503});
    const body=await request.json() as {action?:unknown;kind?:unknown;id?:unknown;hash?:unknown;expectedDigest?:unknown};
    const {located,saved,policy}=await currentContext(env.DB,user.userId);
    if(body.action==='submitted') {
      if(typeof body.id!=='string'||typeof body.hash!=='string')throw Error('Attempt and transaction hash are required.');
      const attempt=await maintenanceById(env.DB,user.userId,body.id);
      if(!attempt||attempt.safe.toLowerCase()!==located.safe.toLowerCase())throw Error('Saved attempt unavailable.');
      if(attempt.hash?.toLowerCase()===body.hash.toLowerCase())return Response.json({attempt:publicAttempt(await reconcileMaintenanceAttempt(env.DB,attempt,located.transport))});
      if(!await recordMaintenanceHash(env.DB,user.userId,body.id,body.hash))throw Error('Attempt already has an outcome or a different hash. Do not resend.');
      const recorded=await maintenanceById(env.DB,user.userId,body.id);
      return Response.json({attempt:publicAttempt(recorded&&await reconcileMaintenanceAttempt(env.DB,recorded,located.transport))});
    }
    if(!['preview','prepare'].includes(String(body.action))||!['renew','revoke'].includes(String(body.kind)))throw Error('Choose Renew or Revoke.');
    const kind=body.kind as MaintenanceKind;
    const pending=await unresolvedMaintenance(env.DB,user.userId,located.safe);
    if(pending) return Response.json({error:'An earlier wallet request is unresolved. Check its transaction before trying again.',attempt:publicAttempt(pending)},{status:409});
    if(kind==='renew') {
      await assertTradingEnabled(env.DB,env);
      const admission=tradingAdmission(located.owner,env);
      if(!admission.ok)throw Error(admission.error);
      if(!maintenanceEligibility(saved.expiresAt).mayRenew)throw Error('Renewal becomes signable after the current UTC window expires. This preserves the daily cap.');
      const old=await readChecks(policy,located.transport);
      if(!old.allOk)throw Error('Existing onchain limits do not match the saved permission. No renewal was offered.');
    }
    await pinnedMultisend(located.transport);
    const nextBase=kind==='renew'?await buildPolicyBase(located):null;
    // The renewal builder must retain the old expiry to prove that it has ended,
    // while using fresh route outputs and current saved limits for the new scope.
    const action=kind==='renew'
      ? maintenanceTransaction(kind,located.owner,{...policy,outputs:nextBase!.base.outputs})
      : maintenanceTransaction(kind,located.owner,policy);
    const [estimate,gasPrice]=await chainReadBatch(CHAIN_RPC,[
      {method:'eth_estimateGas',params:[action.transaction]},
      {method:'eth_gasPrice',params:[]},
    ],located.transport);
    if(typeof estimate!=='string'||typeof gasPrice!=='string')throw Error('Network fee estimate unavailable. Nothing was prepared.');
    const feeWei=BigInt(estimate)*BigInt(gasPrice);
    const digest=keccak256(action.transaction.data);
    const review={safe:located.safe,module:saved.module,capRaw:action.amountRaw,spenders:approvalAddresses,
      expiresAt:action.expiresAt,estimatedNetworkFeeEth:formatEther(feeWei),
      revocation:'Revoke removes the trading role and sets both USDG approvals to zero; balances stay in your wallet.'};
    if(body.action==='preview')return Response.json({kind,digest,review},{headers:{'Cache-Control':'no-store'}});
    if(body.expectedDigest!==digest)throw Error('The permission review changed. Review the new details before signing.');
    const id=await reserveMaintenance(env.DB,{owner:user.userId,ownerAddress:located.owner,safe:located.safe,module:saved.module,
      mandateVersion:saved.mandateVersion,kind,transaction:action.transaction,policy:action.policy,
      startsAt:action.policy.startsAt,expiresAt:action.policy.expiresAt});
    if(!id) return Response.json({error:'An earlier wallet request is unresolved. Do not sign again.'},{status:409});
    return Response.json({id,kind,transaction:action.transaction,review},
      {headers:{'Cache-Control':'no-store'}});
  } catch(error){return Response.json({error:error instanceof Error?error.message:'Permission maintenance unavailable. No transaction was sent.'},{status:409});}
}
