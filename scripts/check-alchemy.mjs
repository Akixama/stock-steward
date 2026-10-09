import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This probe cannot submit transactions or install wallet permissions.
const configPath = fileURLToPath(new URL('../../../private-config/alchemy-credentials.json', import.meta.url));
async function main() {
  let apiKey = process.env.ALCHEMY_API_KEY?.trim();
  if (!apiKey) {
    try { apiKey = JSON.parse(await readFile(configPath, 'utf8')).apiKey?.trim(); }
    catch { throw new Error('Private Alchemy configuration is missing or invalid.'); }
  }
  if (!apiKey || apiKey === 'PASTE_KEY_HERE') throw new Error('Save your Alchemy API key in the private configuration file first.');
  if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('API key format is invalid.');
  let failed = false;
  for (const [network, id] of [['mainnet', 4663], ['testnet', 46630]]) {
    try {
      const response = await fetch(`https://robinhood-${network}.g.alchemy.com/v2/${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['eth_chainId', 'eth_blockNumber', 'eth_gasPrice'].map((method, index) => ({ jsonrpc: '2.0', id: index + 1, method, params: [] }))),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
      const results = await response.json();
      if (!Array.isArray(results)) throw new Error('Provider did not return a batch response.');
      const values = [1, 2, 3].map(index => results.find(item => item.id === index));
      if (values.some(item => !item || item.error || !/^0x[0-9a-f]+$/i.test(item.result))) throw new Error('Provider rejected a read-only RPC method or returned invalid data.');
      if (BigInt(values[0].result) !== BigInt(id)) throw new Error('Network identity does not match Robinhood Chain.');
      console.log(`${network}: verified chain ${id}; block ${BigInt(values[1].result)}; gas price ${BigInt(values[2].result)} wei. No transaction sent.`);
    } catch (error) {
      failed = true;
      // Do not print fetch errors, response bodies, or URLs: these can include credentials.
      const safe = error.message?.startsWith('Provider ') || error.message?.startsWith('Network identity') ? error.message : 'Connection failed or timed out.';
      console.error(`${network}: ${safe}`);
    }
  }
  console.log('This verifies RPC access only. Wallet APIs, permissions, routing and total setup fees remain unverified.');
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
