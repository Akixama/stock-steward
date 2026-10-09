import { readFile } from 'node:fs/promises';
import { buildAccountingEvidence } from '../lib/live-accounting.ts';
import { executionAccounting } from '../lib/execution-accounting.ts';

// Read-only live accounting probe. No signing, no state changes, no transaction submission.
// Usage: node --experimental-strip-types scripts/check-live-accounting.mjs --address 0x… [--target AAPL] [--loss 1000000] [--ledger file.json]
// The ledger file supplies the authenticated owner's rows ({reservedRaw,filledCents,pendingCents,knownHashes,confirmedHashes});
// without one the probe runs with an empty ledger, which is honest for an observed address but never proof of zero spend.
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const address = String(arg('address') ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address) || address === '0x' + '0'.repeat(40)) throw Error('Pass a non-zero --address to observe.');
  const target = String(arg('target') ?? 'AAPL').toUpperCase();
  let key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) { try { key = JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json', import.meta.url), 'utf8')).apiKey?.trim(); } catch { throw Error('Private RPC configuration unavailable.'); } }
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) throw Error('Private RPC configuration unavailable.');

  const rpc = async (method, params) => {
    const response = await fetch(`https://robinhood-mainnet.g.alchemy.com/v2/${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Provider returned an HTTP error.');
    const body = await response.json();
    if (body.error || !Object.hasOwn(body, 'result')) throw Error('Provider rejected a read-only RPC method.');
    return body.result;
  };
  if (BigInt(await rpc('eth_chainId', [])) !== 4663n) throw Error('Network identity does not match Robinhood Chain.');

  const metaCache = new Map();
  const tokenMeta = async (contract) => {
    if (metaCache.has(contract)) return metaCache.get(contract);
    const meta = await rpc('alchemy_getTokenMetadata', [contract]).catch(() => null);
    const ok = meta && typeof meta.symbol === 'string' && Number.isInteger(meta.decimals) && meta.decimals >= 0 && meta.decimals <= 18;
    metaCache.set(contract, ok ? meta : false);
    return ok ? meta : false;
  };

  const sources = {
    block: async () => {
      const number = await rpc('eth_blockNumber', []);
      const header = await rpc('eth_getBlockByNumber', [number, false]);
      return header?.hash ? { hash: header.hash, observedAt: new Date().toISOString() } : null;
    },
    balances: async (addr) => {
      const native = await rpc('eth_getBalance', [addr, 'latest']).catch(() => null);
      if (native === null) return null;
      const list = await rpc('alchemy_getTokenBalances', [addr, 'erc20']).catch(() => null);
      if (!Array.isArray(list?.tokenBalances) || list.tokenBalances.length > 30) return null;
      const rows = [{ symbol: 'ETH', token: '0x' + '0'.repeat(40), raw: BigInt(native).toString(), decimals: 18 }];
      for (const entry of list.tokenBalances) {
        if (entry.error || !/^0x[0-9a-f]*$/i.test(String(entry.tokenBalance ?? ''))) return null;
        const raw = BigInt(entry.tokenBalance).toString();
        if (raw === '0') continue;
        const meta = await tokenMeta(String(entry.contractAddress).toLowerCase());
        if (!meta) return null;
        rows.push({ symbol: meta.symbol.toUpperCase().slice(0, 8), token: String(entry.contractAddress).toLowerCase(), raw, decimals: meta.decimals });
      }
      return rows;
    },
    transfers: async (addr) => {
      const items = [];
      for (const direction of ['fromAddress', 'toAddress']) {
        let pageKey, pages = 0;
        do {
          const body = { category: ['external', 'erc20'], withMetadata: true, maxCount: '0x3e8', fromBlock: '0x0', [direction]: addr };
          if (pageKey) body.pageKey = pageKey;
          const page = await rpc('alchemy_getAssetTransfers', [body]).catch(() => null);
          if (!page || !Array.isArray(page.transfers)) return null;
          for (const t of page.transfers) {
            let raw = null, decimals = null;
            if (t.rawContract?.value && t.rawContract?.decimal) { raw = BigInt(t.rawContract.value).toString(); decimals = parseInt(t.rawContract.decimal, 16); }
            else if (t.asset === 'ETH') { const tx = await rpc('eth_getTransactionByHash', [t.hash]).catch(() => null); if (!tx?.value) return null; raw = BigInt(tx.value).toString(); decimals = 18; }
            if (!raw || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !t.hash || !t.from || !t.to) return null;
            items.push({ hash: String(t.hash).toLowerCase(), from: String(t.from).toLowerCase(), to: String(t.to).toLowerCase(), symbol: (t.asset ?? 'UNKNOWN').toUpperCase().slice(0, 8), token: String(t.rawContract?.address ?? '0x' + '0'.repeat(40)).toLowerCase(), raw, decimals, day: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).toISOString().slice(0, 10) : '' });
          }
          pageKey = page.pageKey; pages++;
        } while (pageKey && pages < 25);
        if (pageKey) return null;
      }
      const seen = new Set();
      return { items: items.filter(t => { const k = `${t.hash}|${t.from}|${t.to}|${t.token}|${t.raw}`; if (seen.has(k)) return false; seen.add(k); return true; }), complete: true };
    },
    priceBound: async (symbol) => {
      const now = Date.now();
      try {
        if (symbol === 'USDG') {
          const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=global-dollar&vs_currencies=usd&include_last_updated_at=true', { signal: AbortSignal.timeout(10000) });
          const g = (await r.json())?.['global-dollar'];
          const spot = Number(g?.usd);
          if (!r.ok || !Number.isFinite(spot) || spot <= 0 || Math.abs(now / 1000 - Number(g?.last_updated_at)) > 600) return null;
          return { upperMicroUsd: String(Math.ceil(spot * 1.005 * 1e6)), lowerMicroUsd: String(Math.floor(spot * 0.995 * 1e6)), priceAt: new Date().toISOString(), source: 'CoinGecko global-dollar spot with a +/-0.5% bound band' };
        }
        if (symbol === 'ETH') {
          const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', { signal: AbortSignal.timeout(10000) });
          const t = await r.json();
          const bid = Number(t?.bidPrice), ask = Number(t?.askPrice);
          if (!r.ok || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return null;
          return { upperMicroUsd: String(Math.ceil(ask * 1e6)), lowerMicroUsd: String(Math.floor(bid * 1e6)), priceAt: new Date().toISOString(), source: 'Binance ETHUSDT bid/ask; USDT is not USD and is treated as a stand-in' };
        }
        const r = await fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const quotes = (await r.json())?.quotes;
        const q = Array.isArray(quotes) ? quotes.find(item => item?.tokenSymbol === symbol && Array.isArray(item.deployments) && item.deployments.some(d => d.chainId === 4663)) : null;
        if (!q || q.currency !== 'USD' || q.isTradingHalt !== false || typeof q.bid !== 'string' || typeof q.ask !== 'string' || !/^\d{1,8}(\.\d{1,4})?$/.test(q.bid) || !/^\d{1,8}(\.\d{1,4})?$/.test(q.ask)) return null;
        const bid = Number(q.bid), ask = Number(q.ask);
        if (!(bid > 0) || ask < bid) return null;
        return { upperMicroUsd: String(Math.ceil(ask * 1e6)), lowerMicroUsd: String(Math.floor(bid * 1e6)), priceAt: new Date().toISOString(), source: 'Robinhood Chain tokenized-equity bid/ask' };
      } catch { return null; }
    },
  };

  const ledger = arg('ledger')
    ? JSON.parse(await readFile(arg('ledger'), 'utf8'))
    : { reservedRaw: '0', filledCents: 0, pendingCents: 0, knownHashes: [], confirmedHashes: [] };
  const assembly = await buildAccountingEvidence(address, target, String(arg('loss') ?? '1000000'), ledger, sources);
  const review = assembly.evidence ? executionAccounting(assembly.evidence, String(arg('input') ?? '1000000'), { maxOrderCents: Number(arg('maxOrderCents') ?? 100), maxDailyCents: Number(arg('maxDailyCents') ?? 200), maxPositionBps: Number(arg('maxPositionBps') ?? 2000) }) : null;
  console.log(JSON.stringify({
    chainId: 4663, address, target,
    evidenceAssembled: !!assembly.evidence,
    activity: assembly.activity.reduce((counts, c) => ({ ...counts, [c.kind]: (counts[c.kind] ?? 0) + 1 }), {}),
    externalBuysTodayCents: assembly.externalBuysTodayCents,
    gaps: assembly.gaps,
    accountingChecks: review ? review.checks.map(c => ({ name: c.name, state: c.state })) : null,
    proposedCents: review?.proposedCents ?? null,
    checksPassed: review?.checksPassed ?? false,
    ledgerSource: arg('ledger') ? 'operator-supplied file' : 'empty probe ledger (not proof of zero spend)',
    executionEnabled: false, transactionSent: false,
  }));
}
main().catch(error => { console.error(error.message ?? 'Live accounting probe unavailable. No transaction sent.'); process.exitCode = 1; });
