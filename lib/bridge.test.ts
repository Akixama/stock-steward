import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBridgeAmount, validateBridgeQuoteRequest, bridgeQuoteUrl, trimBridgeQuote, formatUsdg,
  BRIDGE_DESTINATION } from './bridge.ts';

const address = '0xdc7f175bca1c29a77286a52c857e7fef12f3f662';

test('amounts parse to exact raw units', () => {
  assert.equal(parseBridgeAmount('0.01', 18), '10000000000000000');
  assert.equal(parseBridgeAmount('25', 6), '25000000');
  assert.throws(() => parseBridgeAmount('0', 18));
  assert.throws(() => parseBridgeAmount('-3', 18));
  assert.throws(() => parseBridgeAmount('abc', 6));
});

test('only the supported sources validate; destination is fixed USDG', () => {
  const request = validateBridgeQuoteRequest({
    fromChainId: 1, fromToken: '0x0000000000000000000000000000000000000000',
    fromAmountRaw: '1000', fromAddress: address,
  });
  assert.equal(request.fromChainId, 1);
  const url = bridgeQuoteUrl(request);
  assert.ok(url.includes('toChain=4663'));
  assert.ok(url.includes(`toToken=${encodeURIComponent(BRIDGE_DESTINATION.token)}`));
  assert.ok(url.includes('integrator=stock-steward'));
  assert.throws(() => validateBridgeQuoteRequest({ ...request, fromChainId: 137 }));
  assert.throws(() => validateBridgeQuoteRequest({ ...request, fromToken: address }));
  assert.throws(() => validateBridgeQuoteRequest({ ...request, fromAmountRaw: '0' }));
  assert.throws(() => validateBridgeQuoteRequest({ ...request, fromAddress: 'bad' }));
});

test('incomplete bridge responses are refused, USDG formats to cents', () => {
  assert.throws(() => trimBridgeQuote({}));
  assert.throws(() => trimBridgeQuote({ tool: 'x', transactionRequest: { to: '0x1' } }));
  const quote = trimBridgeQuote({ tool: 'layerswap',
    estimate: { toAmount: '24744322', toAmountUSD: '24.75', executionDuration: 300 },
    transactionRequest: { to: '0x1234', data: '0xab', value: '0x1' } });
  assert.equal(quote.tool, 'layerswap');
  assert.equal(formatUsdg(quote.toAmountRaw), '24.74');
  assert.equal(formatUsdg('5000000'), '5.00');
  assert.equal(formatUsdg('nope'), '—');
});
