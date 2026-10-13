import { decodeAbiParameters, decodeEventLog, parseAbi, parseAbiParameters, type Hex } from 'viem';
import { compileRolesPolicy, type RolesPolicy } from './roles-permission.ts';
import { VENUE,poolIdentity } from './chain-route.ts';
const events = parseAbi(['event ScopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)']);
const swap = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');

// Recover prices only from the installed scope event, then compare the entire
// condition tree against our compiler. Fresh market quotes are never substituted.
export function installedOutputs(policy: RolesPolicy, logs: { data: Hex; topics: Hex[]; removed?: boolean }[]) {
  const compiled = compileRolesPolicy(policy);
  let latest: ReturnType<typeof decodeEventLog<typeof events>> | undefined;
  for (const log of logs) {
    if (log.removed) throw new Error('Noncanonical scope history');
    try {
      const event = decodeEventLog({ abi: events, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.args.roleKey.toLowerCase() === compiled.roleKey.toLowerCase() && event.args.targetAddress.toLowerCase() === policyTarget() && event.args.selector === '0x3593564c') latest = event;
    } catch { /* Unrelated events. */ }
  }
  if (!latest || latest.args.options !== 0) throw new Error('Installed scope unavailable');
  const outputs: RolesPolicy['outputs'] = [];
  for (const condition of latest.args.conditions) {
    if (condition.paramType !== 2 || condition.operator !== 16) continue;
    try {
      const [bytes] = decodeAbiParameters(parseAbiParameters('bytes'), condition.compValue);
      const [decoded] = decodeAbiParameters(swap, bytes);
      if (decoded.amountIn.toString() !== policy.inputRaw) continue;
      const { poolKey } = decoded;
      const token = poolKey.currency0.toLowerCase() === VENUE.settlement ? poolKey.currency1 : poolKey.currency0;
      if(decoded.zeroForOne!==poolIdentity(token,poolKey.fee,poolKey.tickSpacing).zeroForOne)continue;
      if (!policy.outputs.some(output => output.token.toLowerCase() === token.toLowerCase())) continue;
      outputs.push({ token, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, minimumOutputRaw: decoded.amountOutMinimum.toString() });
    } catch { /* Other condition bytes are not swaps. */ }
  }
  const expected = compileRolesPolicy({ ...policy, outputs }).conditions;
  if (JSON.stringify(expected).toLowerCase() !== JSON.stringify(latest.args.conditions).toLowerCase()) throw new Error('Installed conditions differ');
  return outputs;
}
import { EXECUTION_CONTRACTS } from './autonomy.ts';
function policyTarget() { return EXECUTION_CONTRACTS.router.toLowerCase(); }
