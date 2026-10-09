'use client';
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowUpRight, X } from 'lucide-react';
import type { WalletProvider } from '@/lib/browser-wallet';
import BridgePanel from './bridge-panel';

// In-Steward bridging in its own dialog. Quotes come from an established routing
// API; every transfer is signed in the owner's already-connected wallet and
// settles at the quoted bridge. Stock Steward never holds or carries funds.
export default function BridgeDialog({ provider, address }: {
  provider: WalletProvider | null; address: string;
}) {
  const [open, setOpen] = useState(false);
  const short = /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'your wallet';
  return <div className="ws-bridge-embed">
    <div className="ws-bridge-teaser">
      <div><strong>Bridge without leaving Steward</strong>
      <p>Destination is locked to Robinhood Chain · to {short}: USDG for buying power, ETH for gas. You sign every transfer in your own wallet.</p></div>
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
          <Dialog.Description>USDG on Robinhood Chain, straight to {short}. Review every transfer in your wallet before signing.</Dialog.Description>
          <BridgePanel provider={provider} address={address} />
          <div className="ws-bridge-routes">
            <span className="ws-label">PREFER ANOTHER APP?</span>
            <div>
              <a className="ws-recheck" target="_blank" rel="noreferrer"
                href={`https://jumper.exchange/?toChain=4663&toToken=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168${/^0x[0-9a-f]{40}$/i.test(address) ? `&toAddress=${address}` : ''}`}>Jumper ↗</a>
              <a className="ws-recheck" target="_blank" rel="noreferrer"
                href={`https://relay.link/bridge?toChainId=4663&toCurrency=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168${/^0x[0-9a-f]{40}$/i.test(address) ? `&toAddress=${address}` : ''}`}>Relay ↗</a>
              <a className="ws-recheck" target="_blank" rel="noreferrer" href="https://docs.robinhood.com/chain/bridging/">Guide ↗</a>
            </div>
          </div>
          <p className="ws-wallet-dialog-note" role="status">Routes across established bridges. Stock Steward never holds funds.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
