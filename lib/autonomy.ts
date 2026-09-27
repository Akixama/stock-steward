import type {RouterSimulation} from './router-simulation.ts';
import type {RoutePrerequisites} from './route-prerequisites.ts';
import { CHAIN } from './robinhood-chain.ts';
import type { Mandate } from './decision.ts';
import type { RouteEvidence } from './chain-route.ts';

export const EXECUTION_CONTRACTS = {
  router: '0x204FAca1764B154221e35c0d20aBb3c525710498',
  delegate: '0x77021100bD87b7008E5E1989d0eB38555d0d0000',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
} as const;
export type Infrastructure = { chainId: number; block: string; gasPriceWei: string; contracts: Record<keyof typeof EXECUTION_CONTRACTS, number>; observedAt: string };
export type AutonomyReceipt = { id: string; address: string; createdAt: string; policyVersion: number | null;
  status: 'blocked'; executionEnabled: false; infrastructure: Infrastructure | null;
  checks: { name: string; state: 'pass' | 'pending' | 'fail'; reason: string }[];
  why: string; nextSteps: string[];trigger?:'scheduled';workerRunId?:string;observationId?:string;route?:RouteEvidence;prerequisites?:RoutePrerequisites|null;routerSimulation?:RouterSimulation };

export async function readInfrastructure(fetcher: typeof fetch = fetch): Promise<Infrastructure> {
  async function rpc(method: string, params: unknown[]) {
    const response = await fetcher(CHAIN.rpc, { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('RPC unavailable');
    const body = await response.json() as {result?: string; error?: unknown};
    if (body.error || !/^0x[0-9a-f]*$/i.test(body.result ?? '')) throw new Error('Invalid RPC evidence');
    return body.result!;
  }
  const identity = await rpc('eth_chainId', []);
  if (BigInt(identity) !== BigInt(CHAIN.id)) throw new Error('Wrong network');
  const block = await rpc('eth_blockNumber', []);
  const gas = await rpc('eth_gasPrice', []);
  const contracts = {} as Infrastructure['contracts'];
  await Promise.all(Object.entries(EXECUTION_CONTRACTS).map(async ([name,address]) => {
    const code = await rpc('eth_getCode', [address,block]);
    if (code.length % 2 !== 0) throw new Error('Invalid bytecode');
    contracts[name as keyof typeof EXECUTION_CONTRACTS] = (code.length - 2) / 2;
  }));
  return {chainId:CHAIN.id,block,gasPriceWei:BigInt(gas).toString(),contracts,observedAt:new Date().toISOString()};
}

export function autonomyReadiness(address: string, mandate: Mandate | null, infrastructure: Infrastructure | null, now = new Date()): AutonomyReceipt {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('Invalid address');
  const fresh = !!infrastructure && infrastructure.chainId === CHAIN.id && Number.isFinite(Date.parse(infrastructure.observedAt)) &&
    now.getTime() - Date.parse(infrastructure.observedAt) >= 0 && now.getTime() - Date.parse(infrastructure.observedAt) <= 120000;
  const checks: AutonomyReceipt['checks'] = [
    {name:'Saved boundaries',state:mandate?.version ? 'pass':'pending',reason:mandate?.version ? `Saved mandate v${mandate.version}. Saving boundaries grants no wallet authority.`:'Save your purchase boundaries first.'},
    {name:'Autonomy preference',state:mandate?.executionPreference === 'automatic' ? 'pass':'pending',reason:'Automatic mode is a preference; activation requires a separate verified wallet grant.'},
    {name:'Mainnet infrastructure',state:fresh && Object.values(infrastructure!.contracts).every(bytes=>bytes>0) ? 'pass':'pending',reason:fresh ? 'Documented router, Permit2 and delegate addresses were checked at one block. Bytecode presence is not an audit, liquidity check or successful swap.' : 'Fresh network and contract evidence is unavailable.'},
    {name:'Wallet ownership and delegation',state:'pending',reason:'This public address has not signed an ownership challenge or installed a verified delegation.'},
    {name:'Bounded execution permission',state:'pending',reason:'Spend cap, exact recipients, allowed output tokens, calldata restrictions, expiry and revocation must be enforced and tested together. Broad router access is insufficient.'},
    {name:'Executable stock-token route',state:'pending',reason:'A particular settlement asset, stock-token pool, current liquidity and simulated route have not been verified.'},
    {name:'Funds, daily accounting and concentration',state:'pending',reason:'Fresh settlement funds, portfolio denominator, pending spends and confirmed fills are required before each execution.'},
    {name:'Setup budget',state:'pending',reason:'Gas price alone is not a fee quote. Delegation, permission installation, revocation, data fees and provider fees need estimates within your cap.'},
    {name:'Background execution service',state:'pending',reason:'Read-only monitoring can be scheduled separately. No session signer or live spending executor is enabled.'},
  ];
  return {id:crypto.randomUUID(),address:address.toLowerCase(),createdAt:now.toISOString(),policyVersion:mandate?.version ?? null,
    status:'blocked',executionEnabled:false,infrastructure,checks,
    why:'Steward cannot spend yet. Required authority and execution evidence are missing; no transaction was prepared or submitted.',
    nextSteps:checks.filter(check=>check.state!=='pass').map(check=>check.name)};
}

// Future execution must reserve funds atomically before submission. Unknown submissions retain
// their reservation until onchain reconciliation establishes a final outcome.
export type SpendState = 'reserved' | 'submitted' | 'unknown' | 'confirmed' | 'released';
export function transitionSpend(from: SpendState, to: SpendState) {
  const transitions: Record<SpendState, SpendState[]> = {reserved:['submitted','unknown','released'],submitted:['unknown','confirmed','released'],unknown:['submitted','confirmed','released'],confirmed:[],released:[]};
  if (!transitions[from].includes(to)) throw new Error('Invalid spend transition');
  return to;
}
export function executionDay(now: Date) { if (!Number.isFinite(now.getTime())) throw new Error('Invalid date'); return now.toISOString().slice(0,10); }

// Only pass ownership read from the authenticated owner's storage. Historical proof is not delegation.
export function attachHistoricalControl(receipt:AutonomyReceipt,ownership:{address:string;verifiedAt:string|null}|null){
 if(!ownership?.verifiedAt||ownership.address.toLowerCase()!==receipt.address.toLowerCase()||!Number.isFinite(Date.parse(ownership.verifiedAt)))return receipt;
 const delegation=receipt.checks.find(c=>c.name==='Wallet ownership and delegation');if(delegation)delegation.reason='Historical wallet control was verified. A separate bounded spending delegation has not been verified.';
 if(!receipt.checks.some(c=>c.name==='Historical wallet control'))receipt.checks.unshift({name:'Historical wallet control',state:'pass',reason:'Control signature verified '+ownership.verifiedAt+'. This grants no spending authority and does not guarantee current or future control.'});
 receipt.nextSteps=receipt.checks.filter(c=>c.state!=='pass').map(c=>c.name);return receipt;
}
