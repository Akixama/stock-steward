import { encodeFunctionData, pad, parseAbi, type Address, type Hex } from 'viem';
import { encodeBatch, PERMIT2 } from './install-flow.ts';
import { MULTISEND } from './safe-setup.ts';
import { ownerSafeAbi } from './previous-wallet-transfer.ts';
import { routerCandidate } from './router-candidate.ts';
import { EXECUTION_CONTRACTS } from './autonomy.ts';
import { VENUE, type RouteEvidence } from './chain-route.ts';

const ercApproveAbi = parseAbi(['function approve(address spender,uint256 amount) returns (bool)']);
const permitApproveAbi = parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** One owner-signed Safe transaction: cap stock approval, swap it, receive USDG in the same Safe. */
export function ownerSaleTransaction(route: RouteEvidence, owner: Address) {
  if (route.side !== 'sell' || !/^0x[0-9a-f]{40}$/i.test(owner) || owner.toLowerCase() === ZERO ||
      route.settlement.toLowerCase() !== VENUE.settlement ||
      !route.best || !route.minimumOutputRaw ||
      BigInt(route.inputRaw) <= 0n || BigInt(route.inputRaw) > 2n ** 160n - 1n ||
      Date.parse(route.expiresAt) <= Date.now()) throw Error('A fresh, bounded sell quote is required.');
  const candidate = routerCandidate(route, null);
  const calls = [
    { to: route.token as Address, data: encodeFunctionData({ abi: ercApproveAbi, functionName: 'approve', args: [PERMIT2, BigInt(route.inputRaw)] }) },
    { to: PERMIT2, data: encodeFunctionData({ abi: permitApproveAbi, functionName: 'approve', args: [route.token as Address, EXECUTION_CONTRACTS.router as Address, BigInt(route.inputRaw), Math.floor(Date.parse(route.expiresAt) / 1000)] }) },
    { to: EXECUTION_CONTRACTS.router as Address, data: candidate.data },
  ];
  const signature = (pad(owner, { size: 32 }) + '0'.repeat(64) + '01') as Hex;
  return {
    from: owner,
    to: route.address as Address,
    value: '0x0' as const,
    data: encodeFunctionData({ abi: ownerSafeAbi, functionName: 'execTransaction', args: [MULTISEND.address as Address, 0n, encodeBatch(calls), 1, 0n, 0n, 0n, ZERO, ZERO, signature] }),
    inputRaw: route.inputRaw,
    minimumUsdgRaw: route.minimumOutputRaw,
    expiresAt: route.expiresAt,
  };
}
