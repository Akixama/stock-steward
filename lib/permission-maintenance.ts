import { decodeFunctionResult, encodeFunctionData, keccak256, pad, parseAbi, toHex, type Address, type Hex } from 'viem';
import { EXECUTION_CONTRACTS } from './autonomy.ts';
import { VENUE } from './chain-route.ts';
import { encodeBatch, PERMIT2 } from './install-flow.ts';
import { compileRolesPolicy, type RolesPolicy } from './roles-permission.ts';
import { MULTISEND } from './safe-setup.ts';
import { permissionWindow, renewalState } from './permission-window.ts';

const safeAbi = parseAbi(['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)']);
const tokenAbi = parseAbi(['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)']);
const permitAbi = parseAbi(['function approve(address,address,uint160,uint48)','function allowance(address,address,address) view returns (uint160 amount,uint48 expiration,uint48 nonce)']);
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export const approvalAddresses = { token: VENUE.settlement, permit2: PERMIT2, router: EXECUTION_CONTRACTS.router } as const;

export type FundingReadback = { tokenRaw: bigint; permitRaw: bigint; permitExpiresAt: number };
export function decodeFundingReadback(tokenResult: Hex, permitResult: Hex): FundingReadback {
  const tokenRaw = decodeFunctionResult({ abi: tokenAbi, functionName: 'allowance', data: tokenResult }) as bigint;
  const [permitRaw, expiration] = decodeFunctionResult({ abi: permitAbi, functionName: 'allowance', data: permitResult }) as readonly [bigint, number, number];
  return { tokenRaw, permitRaw, permitExpiresAt: Number(expiration) };
}
export function fundingCalls(safe: Address) {
  return [
    { to: VENUE.settlement as Address, data: encodeFunctionData({ abi: tokenAbi, functionName: 'allowance', args: [safe, PERMIT2] }) },
    { to: PERMIT2, data: encodeFunctionData({ abi: permitAbi, functionName: 'allowance', args: [safe, VENUE.settlement as Address, EXECUTION_CONTRACTS.router as Address] }) },
  ];
}

export function maintenanceEligibility(oldExpiry: number, now = Date.now()) {
  const state = renewalState(oldExpiry, now);
  return { state, mayRenew: state === 'expired', notice: state === 'soon' || state === 'expired' };
}

export function renewedPolicy(previous: RolesPolicy, now = new Date()): RolesPolicy {
  if (renewalState(previous.expiresAt, now.getTime()) !== 'expired') throw Error('Wait until the current permission expires before signing renewal. This preserves the daily quota.');
  const window = permissionWindow(now);
  if (window.expiresAt <= previous.expiresAt) throw Error('No new permission window is available yet.');
  return { ...previous, ...window };
}

export function maintenanceTransaction(kind: 'renew' | 'revoke', owner: Address,
  policy: RolesPolicy, now = new Date()) {
  if (owner.toLowerCase() !== policy.session.toLowerCase()) throw Error('Only the verified owner can maintain this permission.');
  const compiled = compileRolesPolicy(policy);
  const next = kind === 'renew' ? renewedPolicy(policy, now) : policy;
  const nextCompiled = kind === 'renew' ? compileRolesPolicy(next) : compiled;
  const amount = kind === 'renew' ? BigInt(next.totalRaw) : 0n;
  const expiration = kind === 'renew' ? next.expiresAt : 0;
  const tokenApproval = { to: VENUE.settlement as Address,
    data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [PERMIT2, amount] }) };
  const permitApproval = { to: PERMIT2,
    data: encodeFunctionData({ abi: permitAbi, functionName: 'approve',
      args: [VENUE.settlement as Address, EXECUTION_CONTRACTS.router as Address, amount, expiration] }) };
  const calls = kind === 'renew'
    ? [...nextCompiled.calls.slice(0, 4), tokenApproval, permitApproval, nextCompiled.calls[4]]
    : [compiled.revocation, tokenApproval, permitApproval];
  const signature = (pad(owner, { size: 32 }) + '0'.repeat(64) + '01') as Hex;
  const data = encodeFunctionData({ abi: safeAbi, functionName: 'execTransaction',
    args: [MULTISEND.address as Address, 0n, encodeBatch(calls), 1, 0n, 0n, 0n, ZERO, ZERO, signature] });
  return { transaction: { from: owner, to: policy.account, value: '0x0' as const, data },
    policy: next, compiled: nextCompiled, calls, amountRaw: amount.toString(), expiresAt: next.expiresAt };
}

export function renewalVerified(policy: RolesPolicy, funding: FundingReadback, checks: { ok: boolean }[]) {
  return checks.length === 7 && checks.every(check => check.ok)
    && funding.tokenRaw === BigInt(policy.totalRaw) && funding.permitRaw === BigInt(policy.totalRaw)
    && funding.permitExpiresAt === policy.expiresAt && Date.now() < policy.expiresAt * 1000;
}
export function revocationVerified(member: boolean, funding: FundingReadback) {
  return !member && funding.tokenRaw === 0n && funding.permitRaw === 0n;
}

export function hashMaintenanceTransaction(data: Hex) { return keccak256(data); }

export const safeExecutionSuccessTopic=keccak256(toHex('ExecutionSuccess(bytes32,uint256)'));
export type MaintenanceReceipt={status?:string;blockNumber?:string;logs?:{address:string;topics:string[]}[]};
export type MaintenanceChainTransaction={from?:string;to?:string;input?:string;value?:string;chainId?:string};
export function maintenanceReceiptProof(
  expected:{ownerAddress:string;safe:string;transaction:{data:string}},
  receipt:MaintenanceReceipt|null, transaction:MaintenanceChainTransaction|null, finalizedBlock:string|null,
):'unknown'|'reverted'|'success'{
  if(!receipt||!transaction||!finalizedBlock||!receipt.blockNumber)return 'unknown';
  try{
    if(BigInt(receipt.blockNumber)>BigInt(finalizedBlock))return 'unknown';
    const exact=transaction.from?.toLowerCase()===expected.ownerAddress.toLowerCase()
      &&transaction.to?.toLowerCase()===expected.safe.toLowerCase()
      &&transaction.input?.toLowerCase()===expected.transaction.data.toLowerCase()
      &&BigInt(transaction.value??'-1')===0n
      &&(!transaction.chainId||BigInt(transaction.chainId)===4663n);
    if(!exact)return 'unknown';
    if(receipt.status==='0x0')return 'reverted';
    if(receipt.status==='0x1'&&receipt.logs?.some(log=>log.address.toLowerCase()===expected.safe.toLowerCase()
      &&log.topics[0]?.toLowerCase()===safeExecutionSuccessTopic.toLowerCase()))return 'success';
  }catch{return 'unknown';}
  return 'unknown';
}
