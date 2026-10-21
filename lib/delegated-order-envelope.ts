import { concatHex, decodeFunctionData, padHex, parseAbi, type Hex } from 'viem';

// MetaMask Delegation Framework v1.3.0 deployment and the runtime observed on
// Robinhood Chain. A different manager or runtime is never accepted as proof.
export const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
export const DELEGATION_MANAGER_RUNTIME_HASH = '0xe45747f90ecec2ba96ae9f4a15c36289653efdfef7690bcfb90a1945bb0fe207';
const DELEGATOR_IMPLEMENTATION = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const redeemAbi = parseAbi(['function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)']);

export type BoundOrderTransaction = {
  from?: string; to?: string; input?: string; value?: string; type?: string; chainId?: string;
  authorizationList?: { address?: string; chainId?: string }[];
};

export function boundOwnerEnvelope(tx: BoundOrderTransaction, expected: { from: string; to: string; data: string; value: string }): 'direct' | 'delegated' | null {
  if (tx.from?.toLowerCase() !== expected.from.toLowerCase() || tx.value !== expected.value) return null;
  if (tx.to?.toLowerCase() === expected.to.toLowerCase() && tx.input === expected.data) return 'direct';
  if (tx.to?.toLowerCase() !== DELEGATION_MANAGER.toLowerCase() || tx.type !== '0x4'
    || tx.chainId !== '0x1237' || tx.authorizationList?.length !== 1
    || tx.authorizationList[0].address?.toLowerCase() !== DELEGATOR_IMPLEMENTATION.toLowerCase()
    || tx.authorizationList[0].chainId !== '0x1237' || !tx.input) return null;
  try {
    const decoded = decodeFunctionData({ abi: redeemAbi, data: tx.input as Hex });
    const [contexts, modes, executions] = decoded.args;
    if (contexts.length !== 1 || contexts[0].length <= 2 || modes.length !== 1
      || modes[0] !== `0x${'0'.repeat(64)}` || executions.length !== 1) return null;
    // ERC-7579 single execution: target (20 bytes), value (32 bytes), calldata.
    // The entire inner call must match the reviewed order, with no second call.
    const inner = concatHex([expected.to as Hex, padHex(expected.value as Hex, { size: 32 }), expected.data as Hex]);
    return executions[0].toLowerCase() === inner.toLowerCase() ? 'delegated' : null;
  } catch { return null; }
}
