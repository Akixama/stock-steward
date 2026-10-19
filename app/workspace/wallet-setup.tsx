'use client';
import { useEffect, useRef, useState } from 'react';
import { toHex } from 'viem';
import { Check } from 'lucide-react';
import WalletConnect from './wallet-connect';
import { useWalletSession, shareWalletSession } from './wallet-session';
import { matchingWallet, switchRobinhood, type WalletProvider } from '@/lib/browser-wallet';
import type { OwnershipChallenge } from '@/lib/wallet-ownership';

// One wallet setup, one flow: connect → Robinhood Chain → ownership proof. Each
// step still pops its own MetaMask approval (wallets never let a site batch those),
// but the owner clicks once and the flow walks through the rest in order. A
// finished setup collapses to a status bar; verification persists server-side so
// it never repeats across visits. Only the connection itself repeats per visit,
// because wallets deliberately forget connections when the page closes.
export default function WalletSetup({ onAddress, onProvider, onVerified, disabled, view = 'all' }: {
  onAddress: (address: string) => void; onProvider: (provider: WalletProvider | null) => void;
  onVerified?: (verified: boolean) => void; disabled: boolean; view?: 'all' | 'connect' | 'verify';
}) {
  const session = useWalletSession();
  const [chainId, setChainId] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [verifiedAddress,setVerifiedAddress]=useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const generation = useRef(0);

  useEffect(() => { onProvider(session?.provider ?? null); onAddress(session?.address ?? ''); }, [session, onAddress, onProvider]);
  useEffect(() => {
    const current = ++generation.current;
    const reset = setTimeout(() => { if(current===generation.current){setVerifiedAt(null);setBusy(false);setError('');setStep('');} },0);
    const provider = session?.provider;
    if (!provider) { const timer = setTimeout(() => setChainId(null), 0); return () => {clearTimeout(timer);clearTimeout(reset);generation.current++;}; }
    let alive = true;
    provider.request({ method: 'eth_chainId' })
      .then((chain) => { if (alive) setChainId(typeof chain === 'string' ? chain : null); })
      .catch(() => { if (alive) setChainId(null); });
    const changed = () => provider.request({ method: 'eth_chainId' })
      .then((chain) => { if (alive) setChainId(typeof chain === 'string' ? chain : null); }).catch(() => {});
    provider.on?.('chainChanged', changed);
    return () => { alive = false; clearTimeout(reset);generation.current++;provider.removeListener?.('chainChanged', changed); };
  }, [session]);
  useEffect(() => {
    if (!session) { const timer = setTimeout(() => setVerifiedAt(null), 0); return () => clearTimeout(timer); }
    let controller = new AbortController();
    const refresh=()=>{controller.abort();controller=new AbortController();const signal=controller.signal;fetch('/api/workspace/ownership', { cache: 'no-store', signal }).then((response) => response.ok?response.json():Promise.reject())
      .then((raw) => {
        const ownership = (raw as { ownership?: OwnershipChallenge }).ownership;
        if (!signal.aborted){setVerifiedAt(ownership?.address === session.address.toLowerCase() ? ownership.verifiedAt ?? null : null);setVerifiedAddress(session.address.toLowerCase());}
      }).catch(() => {if(!signal.aborted)setVerifiedAt(null);});};
    refresh();window.addEventListener('stock-steward:ownership-changed',refresh);
    return () => {controller.abort();window.removeEventListener('stock-steward:ownership-changed',refresh);};
  }, [session]);

  const onChain = chainId != null && /^(0x[0-9a-f]+|\d+)$/i.test(chainId) && BigInt(chainId) === 4663n;
  const ownershipMatches=!!session&&verifiedAddress===session.address.toLowerCase()&&!!verifiedAt;
  const done = !!session && onChain && ownershipMatches;
  useEffect(() => { onVerified?.(done); }, [done, onVerified]);

  async function verify(provider: WalletProvider, address: string, current: number) {
    setStep('Requesting the ownership message…');
    const challengeResponse = await fetch('/api/workspace/ownership', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'challenge', address }),
    });
    const challengeBody = await challengeResponse.json() as { ownership?: OwnershipChallenge; error?: string };
    if(current!==generation.current)return;
    if (!challengeResponse.ok || !challengeBody.ownership) throw new Error(challengeBody.error ?? 'Ownership message unavailable.');
    const challenge = challengeBody.ownership;
    if (challenge.verifiedAt) { setVerifiedAt(challenge.verifiedAt);setVerifiedAddress(address.toLowerCase()); return; }
    await matchingWallet(provider, address);
    if(current!==generation.current)return;
    setStep('Waiting for your signature in the wallet…');
    const signature = await provider.request({ method: 'personal_sign', params: [toHex(challenge.message), address] }) as string;
    if(current!==generation.current)return;
    await matchingWallet(provider, address);
    if(current!==generation.current)return;
    setStep('Checking the signature…');
    const verifyResponse = await fetch('/api/workspace/ownership', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', challengeId: challenge.challengeId, signature }),
    });
    const verifyBody = await verifyResponse.json() as { ownership?: OwnershipChallenge; error?: string };
    if(current!==generation.current)return;
    if (!verifyResponse.ok || !verifyBody.ownership?.verifiedAt) throw new Error(verifyBody.error ?? 'Verification failed.');
    setVerifiedAt(verifyBody.ownership.verifiedAt);
    setVerifiedAddress(address.toLowerCase());
    window.dispatchEvent(new Event('stock-steward:ownership-changed'));
  }

  async function finishSetup() {
    const provider = session?.provider;
    const address = session?.address;
    if (!provider || !address || busy) return;
    const current=++generation.current;
    setBusy(true); setError('');
    try {
      if (!onChain) {
        setStep('Switching your wallet to Robinhood Chain…');
        await switchRobinhood(provider);
        if(current!==generation.current)return;
        setChainId('4663');
      }
      if (!ownershipMatches) await verify(provider, address,current);
      if(current===generation.current)setStep('');
    } catch (cause) {
      if(current===generation.current){setError(cause instanceof Error ? cause.message : 'Setup did not complete.');setStep('');}
    } finally { if(current===generation.current)setBusy(false); }
  }

  if (view === 'connect') return <div id="ws-wallet-setup" className="ws-v2-setup-stage" aria-busy={busy}>
    <span className="ws-label">STEP 1 · CONNECT</span>
    <h3>Connect your wallet</h3>
    <p>Your wallet stays in your control. Connecting does not approve a purchase.</p>
    {session ? <div className="ws-v2-step-success" role="status"><Check size={17}/><span>Connected · {session.address.slice(0, 6)}…{session.address.slice(-4)}</span></div>
      : <WalletConnect disabled={disabled || busy} onConnected={() => { setError(''); setStep(''); }} />}
    {error && <p className="ws-error" role="alert">{error}</p>}
  </div>;

  if (view === 'verify' && !session) return <div id="ws-wallet-setup" className="ws-v2-setup-stage">
    <span className="ws-label">STEP 2 · VERIFY</span><h3>Connect first</h3>
    <p>Go to Connect, then return here to switch networks and sign the free ownership message.</p>
  </div>;

  if (done) return <div id="ws-wallet-setup" className="ws-wallet-connected" role="status">
    <span className="ws-wallet-dot" aria-hidden="true" />
    <div><strong>Wallet ready · {session!.address.slice(0, 6)}…{session!.address.slice(-4)}</strong>
    <small>Robinhood Chain · ownership verified. You approve wallet actions.</small></div>
    <button type="button" className="ws-recheck" disabled={disabled || busy}
      onClick={() => shareWalletSession(null)}>Disconnect</button>
  </div>;

  return <div id="ws-wallet-setup" className="ws-wallet-setup" aria-busy={busy}>
    <span className="ws-label">{view === 'verify' ? 'STEP 2 · VERIFY' : 'YOUR WALLET / ONE SETUP'}</span>
    <h3>{session?'Verify your wallet.':'Start with your wallet.'}</h3>
    <p>Connect, switch to Robinhood Chain, then sign a free ownership message. Your keys stay in your wallet.</p>
    {!session
      ? <WalletConnect disabled={disabled || busy} onConnected={() => { setError(''); setStep(''); }} />
      : <button type="button" className="ws-action-primary" onClick={finishSetup} disabled={disabled || busy}>
          {busy ? 'Waiting for your wallet…' : !onChain ? 'Switch network & verify' : 'Verify wallet · free signature'}</button>}
    {busy && step && <p className="ws-chain-note" role="status">{step}</p>}
    {error && <p className="ws-error" role="alert">{error}</p>}
    <ol className="ws-bridge-steps" aria-label="Wallet setup progress">
      {[['Connected', !!session], ['Robinhood Chain', onChain], ['Ownership proven', ownershipMatches]].map(([label, complete]) =>
        <li key={label as string} className={complete ? 'done' : ''}>
          <span>{complete ? <Check size={13} /> : ''}</span>{label as string}<span className="sr-only">{complete?' complete':' incomplete'}</span></li>)}
    </ol>
  </div>;
}
