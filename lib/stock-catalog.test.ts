import assert from 'node:assert/strict';
import test from 'node:test';
import { stockCatalog } from './stock-catalog.ts';

test('stock list names active Robinhood Chain tokens and excludes inactive and other-chain assets', () => {
  const contract = (n: string) => `0x${n.repeat(40)}`;
  const assets = [
    { tokenSymbol: 'AAPL', tokenName: 'Apple • Robinhood Token', status: 'ASSET_STATUS_ACTIVE', deployments: [{ chainId: 4663, contractAddress: contract('a') }] },
    { tokenSymbol: 'OLD', tokenName: 'Old Inc. • Robinhood Token', status: 'ASSET_STATUS_INACTIVE', deployments: [{ chainId: 4663, contractAddress: contract('b') }] },
    { tokenSymbol: 'OTHER', tokenName: 'Other Inc. • Robinhood Token', status: 'ASSET_STATUS_ACTIVE', deployments: [{ chainId: 1, contractAddress: contract('c') }] },
  ];
  assert.deepEqual(stockCatalog({ assets }), [{ symbol: 'AAPL', name: 'Apple' }]);
  assert.throws(() => stockCatalog({ assets: assets.slice(1) }), /No active/);
});
