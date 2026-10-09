'use client';
import { lazy, Suspense, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowUpRight, X } from 'lucide-react';
import type { ToAddress } from '@lifi/widget';

// In-product bridging in its own dialog: the LI.FI route widget mounted only while
// the dialog is open, so it can never fight the workspace for layout or wallet state.
// The user signs every transfer in their own wallet; a licensed protocol settles.
// Stock Steward never holds or carries funds — this is an interface, not a custodian.
const LiFiWidget = lazy(() => import('@lifi/widget').then((module) => ({ default: module.LiFiWidget })));

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

export default function LifiBridge({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const destination = /^0x[0-9a-f]{40}$/i.test(address) ? address : undefined;
  return <div className="ws-bridge-embed">
    <div className="ws-bridge-teaser">
      <div><strong>Bridge without leaving Steward</strong>
      <p>Destination is locked: USDG on Robinhood Chain{destination ? ` · to ${destination.slice(0, 6)}…${destination.slice(-4)}` : ''}. You sign every transfer in your own wallet.</p></div>
      <button type="button" className="ws-action-primary" onClick={() => setOpen(true)}>Open the bridge <ArrowUpRight size={16} /></button>
    </div>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ws-wallet-overlay" />
        <Dialog.Content className="ws-wallet-dialog ws-bridge-dialog" aria-describedby={undefined}>
          <div className="ws-wallet-dialog-head">
            <Dialog.Title>Bring funds to Robinhood Chain</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Close bridge"><X size={20} /></button></Dialog.Close>
          </div>
          <Dialog.Description>USDG on Robinhood Chain, straight to your wallet. Review every transfer in your wallet before signing.</Dialog.Description>
          {open && <Suspense fallback={<p className="ws-chain-brief">Loading the bridge…</p>}>
            <LiFiWidget
              integrator="Stock Steward"
              toChain={4663}
              toToken={USDG}
              toAddress={destination ? { address: destination, chainType: 'EVM' as ToAddress['chainType'] } : undefined}
              appearance="dark"
              variant="wide"
              buildUrl={false}
              theme={{ colorSchemes: { dark: { palette: { primary: { main: '#b8e62e' }, background: { paper: '#1c1b19', default: '#141312' } } } }, shape: { borderRadius: 16 } }}
            />
          </Suspense>}
          <p className="ws-wallet-dialog-note" role="status">Routes across established bridges (LI.FI). Stock Steward never holds funds.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
