import { concat, decodeFunctionData, encodeFunctionData, encodePacked, parseAbi, type Address, type Hex } from 'viem';
const exec = parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)']);
const multi = parseAbi(['function multiSend(bytes transactions)']);

// Keep the already verified batch target and owner signature. Only pack steps
// not yet confirmed; completed quota/configuration calls must not be repeated.
export function remainingInstallData(batch: Hex, steps: Hex[], next: number): Hex {
  if (!Number.isSafeInteger(next) || next < 0 || next >= steps.length) throw new Error('No remaining setup steps.');
  const original = decodeFunctionData({ abi: exec, data: batch });
  const args = [...original.args];
  if (args[3] !== 1 || args[1] !== 0n) throw new Error('Unsupported setup batch.');
  const calls = steps.slice(next).map(data => {
    const call = decodeFunctionData({ abi: exec, data });
    if (call.args[3] !== 0 || call.args[1] !== 0n) throw new Error('Unsupported setup call.');
    const [to, value, inner] = call.args;
    return encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, to as Address, value, BigInt((inner.length - 2) / 2), inner]);
  });
  args[2] = encodeFunctionData({ abi: multi, functionName: 'multiSend', args: [concat(calls)] });
  return encodeFunctionData({ abi: exec, functionName: 'execTransaction', args: args as unknown as typeof original.args });
}
