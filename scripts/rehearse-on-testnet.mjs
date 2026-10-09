import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { encodeFunctionData, decodeFunctionResult, decodeEventLog, keccak256, parseAbi, toHex, pad } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createWalletClient, createPublicClient, custom, defineChain } from 'viem';
import { safeSetupPlan, safeFactoryAbi, SAFE_CONTRACTS } from '../lib/safe-setup.ts';
import { rolesDeploymentCall, compileRolesPolicy, approvedRouterCall, rolesAbi, rolesFactoryAbi } from '../lib/roles-permission.ts';

// Live testnet dress rehearsal of the permission lifecycle: wallet + module creation, policy
// install, negative authorization proofs (eth_call simulations), revocation. It never touches
// mainnet, never sends anything but testnet gas transactions, and never prints any key.
// The swap-execution leg is NOT rehearsed here: the Universal Router is not deployed on testnet
// (permission-lab --actual-router covers it against real mainnet runtimes in a local EVM).
const CHAIN_ID = 46630;
const zero = '0x0000000000000000000000000000000000000000';

async function main() {
  // Signer key: operator-supplied testnet key only. Never read any other credential file.
  let signerKey = process.env.TESTNET_PRIVATE_KEY?.trim();
  if (!signerKey) {
    try { signerKey = JSON.parse(await readFile(new URL('../../../private-config/testnet-credentials.json', import.meta.url), 'utf8')).privateKey?.trim(); } catch { /* blocked below */ }
  }
  if (!signerKey || !/^0x[0-9a-fA-F]{64}$/.test(signerKey)) {
    console.log(JSON.stringify({ chainId: CHAIN_ID, rehearsalBlockedOn: 'gas-funded testnet key (faucet step, operator action)', hint: 'Set TESTNET_PRIVATE_KEY or private-config/testnet-credentials.json {"privateKey":"0x…"} after funding it from a testnet faucet.', deploymentRehearsalRun: false, transactionSent: false }));
    process.exit(1);
  }
  let rpcKey = process.env.ALCHEMY_API_KEY?.trim();
  if (!rpcKey) { try { rpcKey = JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json', import.meta.url), 'utf8')).apiKey?.trim(); } catch { throw Error('Private RPC configuration unavailable.'); } }
  if (!rpcKey || !/^[A-Za-z0-9_-]+$/.test(rpcKey)) throw Error('Private RPC configuration unavailable.');

  const chain = defineChain({ id: CHAIN_ID, name: 'Robinhood Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://robinhood-testnet.g.alchemy.com/v2/'] } }, testnet: true });
  const account = privateKeyToAccount(signerKey);
  const transport = custom({ async request({ method, params }) {
    const response = await fetch(`https://robinhood-testnet.g.alchemy.com/v2/${rpcKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('RPC unavailable');
    const body = await response.json();
    if (body.error) throw Error('RPC call rejected');
    return body.result;
  }});
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const rpcFetch = async (_input, init) => fetch(`https://robinhood-testnet.g.alchemy.com/v2/${rpcKey}`, { ...init, signal: AbortSignal.timeout(20000) });

  const steps = [];
  const record = (name, ok, detail) => { steps.push({ name, ok, ...(detail !== undefined ? { detail } : {}) }); if (!ok) throw Error(`Rehearsal step failed: ${name}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`); };
  if (BigInt(await publicClient.getChainId()) !== BigInt(CHAIN_ID)) throw Error('Network identity does not match Robinhood testnet');
  const balance = await publicClient.getBalance({ address: account.address });
  steps.push({ name: 'signer_funded', ok: balance > 0n, detail: `balance ${balance.toString()} wei` });
  if (balance === 0n) throw Error('Signer has no testnet gas');

  // 1. Owner Safe via the canonical factory (CREATE2 prediction checked against the receipt).
  // proxyCreationCode() returns ABI-encoded bytes: decode it or the CREATE2 hash is wrong.
  const rawCreation = await publicClient.call({ to: SAFE_CONTRACTS.factory, data: encodeFunctionData({ abi: safeFactoryAbi, functionName: 'proxyCreationCode' }) });
  const creationCode = decodeFunctionResult({ abi: safeFactoryAbi, functionName: 'proxyCreationCode', data: rawCreation.data });
  const saltNonce = Number(process.env.REHEARSAL_NONCE ?? '1');
  const plan = safeSetupPlan(account.address, pad(toHex(saltNonce), { size: 32 }), creationCode);
  const walletHash = await wallet.sendTransaction({ to: plan.call.to, data: plan.call.data });
  const walletReceipt = await publicClient.waitForTransactionReceipt({ hash: walletHash });
  const creation = walletReceipt.logs.map(l => { try { return decodeEventLog({ abi: safeFactoryAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find(e => e?.eventName === 'ProxyCreation');
  if (!creation) throw Error('Safe creation event missing');
  const safe = creation.args.proxy;
  record('wallet_created', safe.toLowerCase() === plan.account.toLowerCase(), safe);

  // 2. Roles module through the canonical module factory.
  const deployment = rolesDeploymentCall(safe, pad(toHex(2), { size: 32 }));
  const moduleHash = await wallet.sendTransaction({ to: deployment.to, data: deployment.data });
  const moduleReceipt = await publicClient.waitForTransactionReceipt({ hash: moduleHash });
  const moduleLog = moduleReceipt.logs.map(l => { try { return decodeEventLog({ abi: rolesFactoryAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find(e => e?.eventName === 'ModuleProxyCreation');
  if (!moduleLog) throw Error('Module creation event missing');
  const module = moduleLog.args.proxy;
  record('module_created', true, module);

  // 3. Rehearsal policy: fixed-size USDG buys, two output tokens, tight caps and expiry.
  const session = privateKeyToAccount(generatePrivateKey()).address;
  const nowSec = Math.floor(Date.now() / 1000);
  const startsAt = nowSec - (nowSec % 86400);
  const policy = {
    account: safe, module, session, grantId: keccak256(toHex('stock-steward-testnet-rehearsal-grant')),
    routerCodeHash: keccak256(toHex('stock-steward-testnet-rehearsal-router')),
    startsAt, expiresAt: startsAt + 2 * 86400,
    inputRaw: '1000000', dailyRaw: '2000000', totalRaw: '3000000',
    outputs: [
      { token: '0x1111111111111111111111111111111111111111', fee: 3000, tickSpacing: 60, minimumOutputRaw: '123' },
      { token: '0x2222222222222222222222222222222222222222', fee: 500, tickSpacing: 10, minimumOutputRaw: '456' },
    ],
  };
  const compiled = compileRolesPolicy(policy);

  // 4. Install through owner Safe transactions (enable module, then the five config calls).
  // Safe's execTransaction takes TEN arguments — including baseGas. A nine-arg encoding
  // produces a wrong selector that silently no-ops, so match the lab exactly and verify
  // both the simulated return value and receipt logs every time.
  const safeAbi = parseAbi([
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)',
    'function enableModule(address module)',
  ]);
  const signature = pad(account.address, { size: 32 }) + '0'.repeat(64) + '01';
  const ownerCall = async (to, data) => {
    const execData = encodeFunctionData({ abi: safeAbi, functionName: 'execTransaction', args: [to, 0n, data, 0, 0n, 0n, 0n, zero, zero, signature] });
    const simulated = await publicClient.call({ account: account.address, to: safe, data: execData });
    if (simulated.data !== '0x' + '0'.repeat(63) + '1') throw Error('Owner call would not succeed');
    const hash = await wallet.sendTransaction({ to: safe, data: execData });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || receipt.logs.length === 0) throw Error('Owner call had no effect');
    return receipt;
  };
  await ownerCall(safe, encodeFunctionData({ abi: safeAbi, functionName: 'enableModule', args: [module] }));
  for (const call of compiled.calls) await ownerCall(call.to, call.data);
  record('policy_installed', true, compiled.roleKey);

  // The roles-installation reader is mainnet-bound by design (it rejects any non-4663
  // chain and requires the router fingerprint), so the rehearsal mirrors its policy
  // checks directly on testnet: module admin, session membership, quota configuration.
  const getterAbi = parseAbi(['function owner() view returns (address)', 'function avatar() view returns (address)', 'function target() view returns (address)', 'function isModuleEnabled(address) view returns (bool)', 'function allowances(bytes32) view returns (uint256,uint256,uint256,uint256,uint256)']);
  const readGetter = async (functionName, args = []) => {
    const raw = await publicClient.call({ to: module, data: encodeFunctionData({ abi: getterAbi, functionName, args }) });
    return decodeFunctionResult({ abi: getterAbi, functionName, data: raw.data });
  };
  const inspectInstallation = async () => {
    const admins = await Promise.all(['owner', 'avatar', 'target'].map(f => readGetter(f)));
    const adminOk = admins.every(a => String(a).toLowerCase() === safe.toLowerCase());
    const member = await readGetter('isModuleEnabled', [session]);
    const daily = await readGetter('allowances', [compiled.dailyKey]);
    const total = await readGetter('allowances', [compiled.totalKey]);
    const dailyMax = BigInt(policy.dailyRaw) / BigInt(policy.inputRaw), totalMax = BigInt(policy.totalRaw) / BigInt(policy.inputRaw);
    const quotaOk = daily[1] === dailyMax && daily[2] === 86400n && total[1] === totalMax && total[2] === 0n;
    return { ok: adminOk && member === true && quotaOk, detail: { admins: admins.map(String), member, daily: daily.map(String), total: total.map(String) } };
  };

  const installed = await inspectInstallation();
  record('installed_state_verified', installed.ok, installed.detail);

  // 5. Negative authorization proofs as eth_call simulations (free; each must revert).
  const proposal = approvedRouterCall(policy, policy.outputs[0].token, policy.expiresAt - 1);
  const envelopeData = (to, data, roleKey, value = 0n) => encodeFunctionData({ abi: rolesAbi, functionName: 'execTransactionWithRole', args: [to, value, data, 0, roleKey, true] });
  const sim = async (from, data) => {
    try { await publicClient.call({ account: from, to: module, data }); return true; } catch { return false; }
  };
  const approved = envelopeData(proposal.to, proposal.data, compiled.roleKey);
  record('positive_call_passes_conditions', await sim(session, approved), 'router leg hollow on testnet: the call target has no code here');
  const negatives = [
    ['wrong_sender_rejected', !(await sim(account.address, approved))],
    ['wrong_role_key_rejected', !(await sim(session, envelopeData(proposal.to, proposal.data, keccak256(toHex('wrong')))))],
    ['wrong_target_rejected', !(await sim(session, envelopeData(policy.outputs[1].token, proposal.data, compiled.roleKey)))],
    ['native_value_rejected', !(await sim(session, envelopeData(proposal.to, proposal.data, compiled.roleKey, 1n)))],
    ['tampered_calldata_rejected', !(await sim(session, envelopeData(proposal.to, proposal.data.slice(0, -8) + 'deadbeef', compiled.roleKey)))],
  ];
  for (const [name, ok] of negatives) record(name, ok);

  // 6. Revocation through the exact revoke call; the behavioral proof is that the session
  // can no longer execute the approved call at all.
  await ownerCall(compiled.revocation.to, compiled.revocation.data);
  const worksAfterRevocation = await sim(session, approved);
  record('revocation_verified', worksAfterRevocation === false, { sessionStillExecutable: worksAfterRevocation });

  const summary = {
    chainId: CHAIN_ID, block: await publicClient.getBlockNumber().then(n => n.toString()),
    wallet: safe, module, roleKey: compiled.roleKey, session,
    steps, deploymentRehearsalRun: true, swapLeg: 'not rehearsed: Universal Router absent on testnet (covered by permission-lab --actual-router)',
    spendingEnabled: false, executionEnabled: false, transactionSent: true,
  };
  await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../outputs/testnet-rehearsal.json', import.meta.url), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Testnet rehearsal unavailable. No mainnet transaction was sent.'); process.exitCode = 1; });
