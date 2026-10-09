'use client';
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowUpRight, X } from 'lucide-react';

// Bridging happens on established hosted bridges, opened prefilled from Steward.
// (An embedded widget was tried and removed: its wallet picker ships no connector
// technology in this version, so it could never see any wallet. The hosted apps
// carry the full production wallet stack.) Settlement happens at the bridge —
// Stock Steward never holds or carries funds.
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

export default function BridgeDialog({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const destination = /^0x[0-9a-f]{40}$/i.test(address) ? address : undefined;
  const short = destination ? `${destination.slice(0, 6)}…${destination.slice(-4)}` : 'your wallet';
  const jumper = `https://jumper.exchange/?toChain=4663&toToken=${USDG}${destination ? `&toAddress=${destination}` : ''}`;
  const relay = `https://relay.link/bridge?toChainId=4663&toCurrency=${USDG}${destination ? `&toAddress=${destination}` : ''}`;
  return <div className="ws-bridge-embed">
    <div className="ws-bridge-teaser">
      <div><strong>Bridge without leaving Steward</strong>
      <p>Destination is locked: USDG on Robinhood Chain · to {short}. You sign every transfer in your own wallet.</p></div>
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
          <div className="ws-bridge-routes">
            <a className="ws-action-primary ws-bridge-go" target="_blank" rel="noreferrer" href={jumper}>Continue to Jumper <ArrowUpRight size={16} /></a>
            <a className="ws-recheck" target="_blank" rel="noreferrer" href={relay}>Relay instead ↗</a>
            <a className="ws-recheck" target="_blank" rel="noreferrer" href="https://docs.robinhood.com/chain/bridging/">Official guide ↗</a>
          </div>
          <div className="ws-chain-brief"><strong>What to pick inside</strong>
            <p>From: ETH (or USDC) on Ethereum. To: already set to USDG on Robinhood Chain, to your address.</p>
            <p>Keep a few dollars as ETH for gas; the rest can arrive as USDG — your buying power.</p></div>
          <p className="ws-wallet-dialog-note" role="status">Routes across established bridges (LI.FI). Stock Steward never holds funds.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
