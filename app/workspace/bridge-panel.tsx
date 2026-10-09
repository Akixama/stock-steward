'use client';
import { useState } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';
import { BRIDGE_DESTINATIONS, BRIDGE_SOURCES, formatTokenAmount, parseBridgeAmount, type BridgeQuote } from '@/lib/bridge';

// In-Steward bridging: quote, sign and track a transfer to USDG on Robinhood Chain
// using the wallet already connected above. Every transaction is signed in the
// owner's own wallet; the server only fetches quotes and tracks status.

const NATIVE = '0x0000000000000000000000000000000000000000';

async function rpc<T>(provider: WalletProvider, method: string, params?: unknown[]): Promise<T> {
  return await provider.request({ method, params }) as T;
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

  return <div className="ws-bridge-sign">
    {!connected && <p className="ws-chain-note">Connect and verify your wallet above first — the bridge sends only to your own address.</p>}
    <div className="ws-check-fields">
      <label>From chain<select value={chainId} disabled={busy}
        onChange={(event) => { setChainId(Number(event.target.value)); setQuote(null); }}>
        {BRIDGE_SOURCES.map((candidate) => <option key={candidate.chainId} value={candidate.chainId}>{candidate.chainName}</option>)}
      </select></label>
      <label>Token<select value={tokenSymbol} disabled={busy}
        onChange={(event) => { setTokenSymbol(event.target.value as 'ETH' | 'USDC'); setQuote(null); }}>
        {source.tokens.map((candidate) => <option key={candidate.symbol} value={candidate.symbol}>{candidate.symbol}</option>)}
      </select></label>
      <label>Receive on Robinhood Chain<select value={destinationSymbol} disabled={busy}
        onChange={(event) => { setDestinationSymbol(event.target.value as 'USDG' | 'ETH'); setQuote(null); }}>
        {BRIDGE_DESTINATIONS.map((candidate) => <option key={candidate.symbol} value={candidate.symbol}>{candidate.symbol} · {candidate.blurb}</option>)}
      </select></label>
      <label>Amount<input value={amount} disabled={busy} inputMode="decimal" placeholder="0.01"
        onChange={(event) => { setAmount(event.target.value); setQuote(null); }} /></label>
      <button type="button" onClick={getQuote} disabled={!connected || busy || !amount.trim()}>
        {busy && !quote ? 'Finding a route…' : 'Get a quote'}</button>
    </div>
    {quote && <div className="ws-order-plan">
      <span>QUOTE · VIA {quote.tool.toUpperCase()}</span>
      <strong>You receive ≈ {formatTokenAmount(quote.toAmountRaw, destination.decimals)} {destination.symbol} on Robinhood Chain{quote.toAmountUSD ? ` (≈ $${quote.toAmountUSD})` : ''}</strong>
      <p>To your wallet {address.slice(0, 6)}…{address.slice(-4)}. Nothing else can receive it.
        {quote.estimatedSeconds ? ` Usually lands in about ${Math.max(1, Math.round(quote.estimatedSeconds / 60))} minutes.` : ''}</p>
      {!txHash && <button type="button" className="ws-action-primary" onClick={signBridge} disabled={busy}>
        {busy ? 'Waiting on your wallet…' : 'Sign the bridge in my wallet'}</button>}
    </div>}
    {txHash && <p className="ws-chain-brief" role="status">Transfer sent: {txHash.slice(0, 10)}…{txHash.slice(-8)}</p>}
    {tracked && !done && <p className="ws-chain-brief" role="status">{tracked}</p>}
    {done && <div className="ws-chain-brief" role="status"><strong>Funds arrived.</strong><p>{tracked}</p></div>}
    {error && <p className="ws-error" role="alert">{error}</p>}
  </div>;
}
