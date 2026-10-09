'use client';
import { useState } from 'react';
import { ArrowDown, Check, Loader2 } from 'lucide-react';
import type { WalletProvider } from '@/lib/browser-wallet';
import WalletConnect from './wallet-connect';
import { BRIDGE_DESTINATIONS, BRIDGE_SOURCES, formatTokenAmount, parseBridgeAmount, type BridgeQuote } from '@/lib/bridge';

// In-Steward bridging: quote, sign and track a transfer to Robinhood Chain using
// the wallet already connected above. Every transaction is signed in the owner's
// own wallet; the server only fetches quotes and tracks status.

const NATIVE = '0x0000000000000000000000000000000000000000';
const TOKEN_STYLE: Record<string, { glyph: string; tint: string }> = {
  ETH: { glyph: 'Ξ', tint: '#8a9cff' },
  USDC: { glyph: '$', tint: '#4aa8ff' },
  USDG: { glyph: 'G', tint: '#b8e62e' },
};

async function rpc<T>(provider: WalletProvider, method: string, params?: unknown[]): Promise<T> {
  return await provider.request({ method, params }) as T;
}

function TokenBadge({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const style = TOKEN_STYLE[symbol] ?? { glyph: symbol.slice(0, 1), tint: '#b8b7b5' };
  return <span className="ws-token-badge" style={{ width: size, height: size, fontSize: size * 0.52, ['--token-tint' as string]: style.tint }} aria-hidden="true">{style.glyph}</span>;
}

export default function BridgePanel({ provider, address }: {
  provider: WalletProvider | null; address: string;
}) {
  const [chainId, setChainId] = useState(1);
  const [tokenSymbol, setTokenSymbol] = useState<'ETH' | 'USDC'>('ETH');
  const [destinationSymbol, setDestinationSymbol] = useState<'USDG' | 'ETH'>('USDG');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [tracked, setTracked] = useState('');
  const [done, setDone] = useState(false);

  const source = BRIDGE_SOURCES.find((candidate) => candidate.chainId === chainId)!;
  const token = source.tokens.find((candidate) => candidate.symbol === tokenSymbol)!;
  const destination = BRIDGE_DESTINATIONS.find((candidate) => candidate.symbol === destinationSymbol)!;
  const connected = !!provider && /^0x[0-9a-f]{40}$/i.test(address);
  const stage = done ? 3 : txHash ? 2 : quote ? 1 : 0;

  async function getQuote() {
    if (!connected || busy) return;
    setBusy(true); setError(''); setQuote(null); setTxHash(''); setTracked(''); setDone(false);
    try {
      const fromAmountRaw = parseBridgeAmount(amount, token.decimals);
      const response = await fetch('/api/workspace/bridge/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromChainId: source.chainId, fromToken: token.address, fromAmountRaw, fromAddress: address, toToken: destination.token }),
      });
      const payload = await response.json() as { quote?: BridgeQuote; error?: string };
      if (!response.ok || !payload.quote) throw new Error(payload.error ?? 'Bridge quote unavailable.');
      setQuote(payload.quote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bridge quote unavailable.');
    } finally { setBusy(false); }
  }

  async function ensureChain() {
    const current = await rpc<string>(provider!, 'eth_chainId');
    if (BigInt(current) === BigInt(source.chainId)) return;
    try {
      await rpc(provider!, 'wallet_switchEthereumChain', [{ chainId: source.chainHex }]);
    } catch (switchError) {
      if ((switchError as { code?: number })?.code !== 4902) throw switchError;
      const chains: Record<number, object> = {
        1: { chainId: '0x1', chainName: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum.publicnode.com'], blockExplorerUrls: ['https://etherscan.io'] },
        8453: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] },
      };
      await rpc(provider!, 'wallet_addEthereumChain', [chains[source.chainId]]);
    }
    const confirmed = await rpc<string>(provider!, 'eth_chainId');
    if (BigInt(confirmed) !== BigInt(source.chainId)) throw new Error(`Switch your wallet to ${source.chainName} first.`);
  }

  async function waitForReceipt(hash: string): Promise<void> {
    for (let attempt = 0; attempt < 90; attempt++) {
      const receipt = await rpc<{ status?: string } | null>(provider!, 'eth_getTransactionReceipt', [hash]);
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error('The transaction reverted onchain. Nothing further was sent.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Confirmation timed out. Check the transaction in your wallet; do not re-send blindly.');
  }

  async function signBridge() {
    if (!connected || !quote || busy) return;
    setBusy(true); setError('');
    try {
      await ensureChain();
      const accounts = await rpc<string[]>(provider!, 'eth_accounts');
      if (!accounts.some((account) => account.toLowerCase() === address.toLowerCase())) {
        throw new Error('Your wallet no longer exposes this account. Reconnect the matching account.');
      }
      // ERC20 tokens need an approval for the bridge contract first; native ETH does not.
      if (token.address.toLowerCase() !== NATIVE) {
        const allowanceData = '0xdd62ed3e' +
          address.toLowerCase().replace('0x', '').padStart(64, '0') +
          quote.transactionRequest.to.toLowerCase().replace('0x', '').padStart(64, '0');
        const allowanceRaw = await rpc<string>(provider!, 'eth_call',
          [{ to: token.address, data: allowanceData }, 'latest']);
        const needed = BigInt(parseBridgeAmount(amount, token.decimals));
        if (BigInt(allowanceRaw) < needed) {
          const approveData = '0x095ea7b3' +
            quote.transactionRequest.to.toLowerCase().replace('0x', '').padStart(64, '0') +
            needed.toString(16).padStart(64, '0');
          const approveHash = await rpc<string>(provider!, 'eth_sendTransaction',
            [{ from: address, to: token.address, data: `0x${approveData}` }]) as string;
          if (!/^0x[0-9a-f]{64}$/i.test(approveHash)) throw new Error('Wallet returned no approval hash.');
          await waitForReceipt(approveHash);
        }
      }
      const tx = quote.transactionRequest;
      const hash = await rpc<string>(provider!, 'eth_sendTransaction',
        [{ from: address, to: tx.to, data: tx.data, value: tx.value }]) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash.');
      setTxHash(hash);
      await waitForReceipt(hash);
      setTracked('Sent and confirmed on the source chain. Watching the arrival…');
      void track(hash, quote.tool);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The bridge transaction did not complete.');
    } finally { setBusy(false); }
  }

  async function track(hash: string, bridge: string) {
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      try {
        const response = await fetch(
          `/api/workspace/bridge/status?txHash=${hash}&fromChain=${source.chainId}&bridge=${encodeURIComponent(bridge)}`,
          { cache: 'no-store' });
        const payload = await response.json() as { status?: string; substatus?: string; error?: string };
        if (!response.ok) continue;
        const status = payload.status ?? 'UNKNOWN';
        setTracked(`Bridge reports: ${status}${payload.substatus ? ` · ${payload.substatus}` : ''}.`);
        if (status === 'DONE') {
          setDone(true);
          setTracked('Arrived on Robinhood Chain. Press Observe & save in Chain to record it as evidence.');
          return;
        }
        if (status === 'FAILED' || status === 'REFUNDED') {
          setError(`The bridge reports ${status}. Check the transaction hash in an explorer; nothing was re-sent.`);
          return;
        }
      } catch { /* Keep polling; the transfer is unaffected. */ }
    }
    setTracked('Still watching. Keep this tab open — the arrival can take several minutes. Your transaction hash is saved above.');
  }

  return <div className="ws-bridge-fancy">
    {!connected && <div className="ws-bridge-connect">
      <p className="ws-chain-note">Connect your wallet to unlock the bridge — it sends only to your own address. No signature needed to connect.</p>
      <WalletConnect disabled={busy} onConnected={() => { setError(''); }} />
    </div>}
    <ol className="ws-bridge-steps" aria-label="Bridge progress">
      {['Quote', 'Sign', 'Arrive'].map((label, index) => <li key={label} className={stage > index ? 'done' : stage === index ? 'now' : ''}>
        <span>{stage > index ? <Check size={13} /> : index + 1}</span>{label}</li>)}
    </ol>
    <div className="ws-bridge-route">
      <div className="ws-bridge-end">
        <TokenBadge symbol={token.symbol} />
        <div><strong>{amount.trim() || '0.00'} {token.symbol}</strong><small>{source.chainName}</small></div>
      </div>
      <div className={`ws-bridge-lane${quote ? ' live' : ''}`} aria-hidden="true"><span /><ArrowDown size={15} /></div>
      <div className="ws-bridge-end">
        <TokenBadge symbol={destination.symbol} />
        <div><strong>{quote ? `${formatTokenAmount(quote.toAmountRaw, destination.decimals)} ${destination.symbol}` : `… ${destination.symbol}`}</strong><small>Robinhood Chain · {destination.blurb}</small></div>
      </div>
    </div>
    <div className="ws-bridge-form">
      <label>From<select value={`${chainId}:${tokenSymbol}`} disabled={busy || !!txHash}
        onChange={(event) => {
          const [nextChain, nextToken] = event.target.value.split(':');
          setChainId(Number(nextChain)); setTokenSymbol(nextToken as 'ETH' | 'USDC'); setQuote(null);
        }}>
        {BRIDGE_SOURCES.flatMap((candidate) => candidate.tokens.map((candidateToken) =>
          <option key={`${candidate.chainId}:${candidateToken.symbol}`} value={`${candidate.chainId}:${candidateToken.symbol}`}>{candidateToken.symbol} on {candidate.chainName}</option>))}
      </select></label>
      <label>To<select value={destinationSymbol} disabled={busy || !!txHash}
        onChange={(event) => { setDestinationSymbol(event.target.value as 'USDG' | 'ETH'); setQuote(null); }}>
        {BRIDGE_DESTINATIONS.map((candidate) => <option key={candidate.symbol} value={candidate.symbol}>{candidate.symbol} · {candidate.blurb}</option>)}
      </select></label>
      <label className="ws-bridge-amount">Amount<input value={amount} disabled={busy || !!txHash} inputMode="decimal" placeholder="0.01"
        onChange={(event) => { setAmount(event.target.value); setQuote(null); }} /></label>
      {!quote
        ? <button type="button" className="ws-action-primary ws-bridge-cta" onClick={getQuote} disabled={!connected || busy || !amount.trim()}>
            {busy ? <><Loader2 size={16} className="ws-spin" /> Finding the best route…</> : 'Get a quote'}</button>
        : !txHash
          ? <button type="button" className="ws-action-primary ws-bridge-cta" onClick={signBridge} disabled={busy}>
              {busy ? <><Loader2 size={16} className="ws-spin" /> Waiting on your wallet…</> : `Sign the bridge · receive ${formatTokenAmount(quote.toAmountRaw, destination.decimals)} ${destination.symbol}`}</button>
          : null}
    </div>
    {quote && !txHash && <p className="ws-bridge-meta">Via {quote.tool}{quote.toAmountUSD ? ` · ≈ $${quote.toAmountUSD}` : ''}{quote.estimatedSeconds ? ` · lands in about ${Math.max(1, Math.round(quote.estimatedSeconds / 60))} min` : ''}. To your wallet {address.slice(0, 6)}…{address.slice(-4)} — nothing else can receive it.</p>}
    {txHash && <p className="ws-chain-brief" role="status">Transfer sent: {txHash.slice(0, 10)}…{txHash.slice(-8)}</p>}
    {tracked && !done && <p className="ws-chain-brief" role="status">{tracked}</p>}
    {done && <div className="ws-chain-brief" role="status"><strong>Funds arrived.</strong><p>{tracked}</p></div>}
    {error && <p className="ws-error" role="alert">{error}</p>}
  </div>;
}
