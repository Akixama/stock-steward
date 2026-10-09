import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { toFunctionSelector } from 'viem';
import { reviewSetupFees } from '../lib/setup-fees.ts';

// Read-only live setup-cost quote. No signing, no state changes, no transaction submission.
// Prices the permission-lab gas evidence with live chain fee data and a live ETH/USD upper bound.
const CAP_CENTS = 2000; // $20 owner cap; never raise it in code.

async function main() {
  let key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) { try { key = JSON.parse(await readFile(new URL('../../../private-config/alchemy-credentials.json', import.meta.url), 'utf8')).apiKey?.trim(); } catch { throw Error('Private RPC configuration unavailable.'); } }
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) throw Error('Private RPC configuration unavailable.');

  const evidence = JSON.parse(await readFile(new URL('../outputs/setup-fee-gas.json', import.meta.url), 'utf8'));
  if (!Array.isArray(evidence.components) || evidence.components.length !== 6) throw Error('Gas evidence is incomplete. Regenerate it with: node --experimental-strip-types permission-lab/test.mjs --actual-router');

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
  const block = await rpc('eth_blockNumber', []);
  const header = await rpc('eth_getBlockByNumber', [block, false]);
  const gasPrice = BigInt(await rpc('eth_gasPrice', []));
  const baseFee = header?.baseFeePerGas ? BigInt(header.baseFeePerGas) : 0n;
  // Fee ceiling: twice the observed network gas price, at least twice the base fee when present.
  const maxFeePerGasWei = (gasPrice * 2n > baseFee * 2n ? gasPrice * 2n : baseFee * 2n).toString();

  // Data-fee observation: does this chain record an L1 data component on receipts?
  let dataFeeStatus = 'unmeasured';
  try {
    const withTxs = await rpc('eth_getBlockByNumber', [block, true]);
    const first = withTxs?.transactions?.[0];
    if (first?.hash) {
      const receipt = await rpc('eth_getTransactionReceipt', [first.hash]);
      if (receipt && Object.hasOwn(receipt, 'gasUsedForL1')) dataFeeStatus = 'recorded-separately-not-included';
    }
  } catch { /* observation only; the quote reports the gap either way */ }

  // L1 data fee from the chain's own ArbGasInfo estimate; calldata gas 16/byte nonzero,
  // 4/byte zero (uncompressed upper bound — Nitro compression only lowers it). A zero
  // estimate is a measurement, not a failure: the chain currently posts data for free.
  let l1BaseFeeWei = null;
  try {
    const estimate = await rpc('eth_call', [{ to: '0x000000000000000000000000000000000000006C', data: toFunctionSelector('getL1BaseFeeEstimate()') }, block]);
    if (/^0x[0-9a-f]+$/i.test(String(estimate))) l1BaseFeeWei = BigInt(estimate);
  } catch { /* reported as unmeasured below */ }
  const countable = evidence.components.every(c => Number.isInteger(c.calldataNonzeroBytes) && Number.isInteger(c.calldataZeroBytes) && c.calldataNonzeroBytes + c.calldataZeroBytes > 0);
  const dataFeeOf = (c) => l1BaseFeeWei !== null && countable ? (BigInt(16 * c.calldataNonzeroBytes + 4 * c.calldataZeroBytes) * l1BaseFeeWei).toString() : '0';
  if (l1BaseFeeWei !== null && countable) dataFeeStatus = l1BaseFeeWei === 0n ? 'measured-zero' : 'measured-upper-bound';

  // ETH/USD upper bound: Binance 24h ETHUSDT high + 1%, cross-checked against CoinGecko USD spot.
  // USDT is not USD; the cross-check refuses the quote if the two sources disagree by more than 3%.
  let price = null;
  try {
    const [ticker, spot] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_last_updated_at=true', { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
    ]);
    const high = Number(ticker?.highPrice), last = Number(ticker?.lastPrice), spotUsd = Number(spot?.ethereum?.usd), spotAt = Number(spot?.ethereum?.last_updated_at);
    // Integrity check compares like with like (current vs current price, both sources);
    // the cost bound stays the 24h high, which legitimately diverges from spot in volatile markets.
    const consistent = Number.isFinite(high) && Number.isFinite(last) && Number.isFinite(spotUsd) && high > 0 && last > 0 && spotUsd > 0 && Math.abs(last - spotUsd) / last <= 0.03 && Number.isFinite(spotAt) && Math.abs(Date.now() / 1000 - spotAt) <= 600;
    if (consistent) price = { boundUsd: high * 1.01, spotUsd, highUsd: high };
  } catch { /* fall through to an honest pending quote */ }

  const observedAt = Date.now();
  const guard = reviewSetupFees({
    source: 'verified-provider', chainId: 4663, observedAt,
    priceVerified: !!price, maxFeePerGasWei,
    ethUpperMicroUsd: price ? String(Math.ceil(price.boundUsd * 1e6)) : '0',
    components: evidence.components.map(c => ({ name: c.name, gas: c.gas, dataFeeWei: dataFeeOf(c), providerFeeWei: '0' })),
  }, CAP_CENTS);

  const result = {
    capturedAt: new Date(observedAt).toISOString(), chainId: 4663, capCents: CAP_CENTS,
    gasEvidence: { capturedAt: evidence.capturedAt, environment: evidence.environment, policyShape: evidence.policyShape },
    feeData: { block, baseFeePerGasWei: baseFee.toString(), observedGasPriceWei: gasPrice.toString(), maxFeePerGasWei, formula: 'Fee ceiling is twice the observed gas price (and twice the base fee when present).' },
    price: price ? { boundUsd: Number(price.boundUsd.toFixed(2)), spotUsd: price.spotUsd, sources: 'Binance ETHUSDT 24h high + 1% bound; CoinGecko ethereum.usd spot cross-check (current prices within 3%)' } : null,
    guard,
    limitations: [
      'Gas units come from the permission-lab isolated EVM with pinned canonical runtimes and a two-output fixture policy; an exact policy of a different shape may use more or less gas.',
      dataFeeStatus === 'measured-upper-bound' ? 'Chain data (L1 poster) fees are included as an upper bound: measured calldata byte composition at 16 gas/nonzero and 4 gas/zero byte priced at the chain L1 base-fee estimate, uncompressed (compression only lowers it).' : dataFeeStatus === 'measured-zero' ? 'Chain data (L1 poster) fees are included and measured at zero: the chain L1 base-fee estimate is 0 at this block, so data posting is currently free. Recheck before owner signing; the estimate floats.' : dataFeeStatus === 'unmeasured' ? 'Chain data (L1 poster) fees are NOT measured and NOT included; the total may understate by that amount.' : 'This chain records an L1 data component on receipts; that component is NOT included in this quote.',
      'Provider fees are recorded as zero: the operator plan bills compute units, not wei. Gas sponsorship is NOT assumed; the owner pays gas.',
      'This quote is evidence for review. It is not a spending authorization and not a promise of the final cost.',
    ],
    dataFeeStatus, l1BaseFeeWei: l1BaseFeeWei === null ? null : l1BaseFeeWei.toString(), providerFeeWei: '0', transactionSent: false,
  };
  await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../outputs/setup-fee-quote.json', import.meta.url), JSON.stringify(result, null, 2));

  console.log(JSON.stringify({
    chainId: 4663, block, gasEvidenceAt: evidence.capturedAt, policyShape: evidence.policyShape,
    totalGas: evidence.components.reduce((n, c) => n + BigInt(c.gas), 0n).toString(),
    maxFeePerGasWei, ethUpperBoundUsd: price ? Number(price.boundUsd.toFixed(2)) : null,
    quoteState: guard.state, maximumCents: guard.maximumCents, totalWei: guard.totalWei, withinCap: guard.state === 'within_cap',
    liveQuote: guard.liveQuote, dataFeeIncluded: dataFeeStatus === 'measured-upper-bound' || dataFeeStatus === 'measured-zero', executionEnabled: false, transactionSent: false,
  }));
}
main().catch(error => { console.error(error.message ?? 'Setup fee quote unavailable. No transaction sent.'); process.exitCode = 1; });
