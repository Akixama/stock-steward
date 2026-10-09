'use client';
import { lazy, Suspense, useState } from 'react';
import type { ToAddress } from '@lifi/widget';

// In-product bridging: the LI.FI route widget embedded directly in the workspace.
// The user signs every transfer in their own wallet; a licensed protocol settles.
// Stock Steward never holds or carries funds — this is an interface, not a custodian.
const LiFiWidget = lazy(() => import('@lifi/widget').then((module) => ({ default: module.LiFiWidget })));

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

export default function LifiBridge({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  return <div className="ws-bridge-embed">
    {!open
      ? <div className="ws-bridge-teaser">
          <div><strong>Bridge without leaving Steward</strong>
          <p>Destination is locked: USDG on Robinhood Chain{address && /^0x[0-9a-f]{40}$/i.test(address) ? ` · to ${address.slice(0, 6)}…${address.slice(-4)}` : ''}. You sign every transfer in your own wallet.</p></div>
          <button type="button" className="ws-action-primary" onClick={() => setOpen(true)}>Open the bridge</button>
        </div>
      : <div className="ws-bridge-box">
          <Suspense fallback={<p className="ws-chain-brief">Loading the bridge…</p>}>
            <LiFiWidget
              integrator="Stock Steward"
              toChain={4663}
              toToken={USDG}
              toAddress={/^0x[0-9a-f]{40}$/i.test(address) ? { address, chainType: 'EVM' as ToAddress['chainType'] } : undefined}
              appearance="dark"
              variant="wide"
              theme={{ colorSchemes: { dark: { palette: { primary: { main: '#b8e62e' }, background: { paper: '#141312', default: '#0f0e0d' } } } }, shape: { borderRadius: 16 } }}
            />
          </Suspense>
          <small>Routes across established bridges (LI.FI). You sign every transfer in your wallet; Stock Steward never holds funds.</small>
        </div>}
  </div>;
}
