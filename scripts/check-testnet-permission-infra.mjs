import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { ROLES_CONTRACTS, ROLES_RUNTIME_HASHES } from '../lib/roles-permission.ts';
import { EXECUTION_CONTRACTS } from '../lib/autonomy.ts';
import { SAFE_CONTRACTS, SAFE_RUNTIME_HASHES } from '../lib/safe-setup.ts';

// Read-only testnet rehearsal readiness probe. No signing, no state changes, no transaction submission.
// It reports which canonical permission-infrastructure runtimes are deployed on Robinhood testnet
// and whether the configured credential can reach a bundler. A live deployment rehearsal additionally
// needs a gas-funded testnet key, which is a separate operator step and is never read from disk here.
async function main() {
  let key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) { try { key = JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json', import.meta.url), 'utf8')).apiKey?.trim(); } catch { throw Error('Private RPC configuration unavailable.'); } }
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) throw Error('Private RPC configuration unavailable.');
  const rpc = async (method, params) => {
    const response = await fetch(`https://robinhood-testnet.g.alchemy.com/v2/${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Provider returned an HTTP error.');
    const body = await response.json();
    if (body.error || !Object.hasOwn(body, 'result')) throw Error('Provider rejected the RPC method.');
    return body.result;
  };
  if (BigInt(await rpc('eth_chainId', [])) !== 46630n) throw Error('Network identity does not match Robinhood testnet.');
  const block = await rpc('eth_blockNumber', []);
  const gasPrice = BigInt(await rpc('eth_gasPrice', []));

  const check = async (name, address, pinned) => {
    const code = await rpc('eth_getCode', [address, block]);
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) return { name, address, deployed: false };
    const hash = keccak256(code);
    return { name, address, deployed: true, bytes: (code.length - 2) / 2, matchesPinnedMainnetRuntime: pinned ? hash.toLowerCase() === pinned.toLowerCase() : null };
  };
  const contracts = [];
  for (const [name, address] of Object.entries(SAFE_CONTRACTS)) contracts.push(await check(`safe.${name}`, address, SAFE_RUNTIME_HASHES[name]));
  for (const [name, address] of Object.entries(ROLES_CONTRACTS)) contracts.push(await check(`roles.${name}`, address, ROLES_RUNTIME_HASHES[name]));
  for (const [name, address] of Object.entries(EXECUTION_CONTRACTS)) contracts.push(await check(`venue.${name}`, address, null));

  let bundler = 'unavailable';
  try {
    const entries = await rpc('eth_supportedEntryPoints', []);
    bundler = Array.isArray(entries) && entries.length > 0 ? `available (${entries.length} entry points)` : 'reachable with no entry points';
  } catch { /* reported as unavailable */ }

  const missing = contracts.filter(c => !c.deployed).map(c => c.name);
  console.log(JSON.stringify({
    chainId: 46630, block, gasPriceWei: gasPrice.toString(),
    contracts, bundler,
    rehearsalBlockedOn: missing.length ? `Not deployed on testnet: ${missing.join(', ')}.` : 'All pinned permission runtimes are deployed on testnet.',
    fundedTestnetSigner: 'Not configured. A deployment rehearsal needs a gas-funded testnet key supplied by the operator; this probe never reads signing keys.',
    deploymentRehearsalRun: false, transactionSent: false,
  }));
}
main().catch(error => { console.error(error.message ?? 'Testnet readiness probe unavailable. No transaction sent.'); process.exitCode = 1; });
