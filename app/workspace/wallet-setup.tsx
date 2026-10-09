'use client';
import { useEffect, useState } from 'react';
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
export default function WalletSetup({ onAddress, onProvider, disabled }: {
  onAddress: (address: string) => void; onProvider: (provider: WalletProvider | null) => void; disabled: boolean;
}) {
  const session = useWalletSession();
  const [chainId, setChainId] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('');

  useEffect(() => { onProvider(session?.provider ?? null); onAddress(session?.address ?? ''); }, [session, onAddress, onProvider]);
  useEffect(() => {
    const provider = session?.provider;
    if (!provider) { setChainId(null); return; }
    let alive = true;
    provider.request({ method: 'eth_chainId' })
      .then((chain) => { if (alive) setChainId(typeof chain === 'string' ? chain : null); })
      .catch(() => { if (alive) setChainId(null); });
    const changed = () => provider.request({ method: 'eth_chainId' })
      .then((chain) => { if (alive) setChainId(typeof chain === 'string' ? chain : null); }).catch(() => {});
    provider.on?.('chainChanged', changed);
    return () => { alive = false; provider.removeListener?.('chainChanged', changed); };
  }, [session]);
  useEffect(() => {
    if (!session) { setVerifiedAt(null); return; }
    fetch('/api/workspace/ownership', { cache: 'no-store' }).then((response) => response.json())
      .then((raw) => {
        const ownership = (raw as { ownership?: OwnershipChallenge }).ownership;
        setVerifiedAt(ownership?.address === session.address.toLowerCase() ? ownership.verifiedAt ?? null : null);
      }).catch(() => {});
  }, [session]);

  const onChain = chainId != null && BigInt(chainId) === 4663n;
  const done = !!session && onChain && !!verifiedAt;

  async function verify(provider: WalletProvider, address: string) {
    setStep('Requesting the ownership message…');
    const challengeResponse = await fetch('/api/workspace/ownership', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'challenge', address }),
    });
    const challengeBody = await challengeResponse.json() as { ownership?: OwnershipChallenge; error?: string };
    if (!challengeResponse.ok || !challengeBody.ownership) throw new Error(challengeBody.error ?? 'Ownership message unavailable.');
    const challenge = challengeBody.ownership;
    if (challenge.verifiedAt) { setVerifiedAt(challenge.verifiedAt); return; }
    await matchingWallet(provider, address);
    setStep('Waiting for your signature in the wallet…');
    const signature = await provider.request({ method: 'personal_sign', params: [toHex(challenge.message), address] }) as string;
    await matchingWallet(provider, address);
    setStep('Checking the signature…');
    const verifyResponse = await fetch('/api/workspace/ownership', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', challengeId: challenge.challengeId, signature }),
    });
    const verifyBody = await verifyResponse.json() as { ownership?: OwnershipChallenge; error?: string };
    if (!verifyResponse.ok || !verifyBody.ownership?.verifiedAt) throw new Error(verifyBody.error ?? 'Verification failed.');
    setVerifiedAt(verifyBody.ownership.verifiedAt);
  }

  async function finishSetup() {
    const provider = session?.provider;
    const address = session?.address;
    if (!provider || !address || busy) return;
    setBusy(true); setError('');
    try {
      if (!onChain) {
        setStep('Switching your wallet to Robinhood Chain…');
        await switchRobinhood(provider);
        setChainId('4663');
      }
      if (!verifiedAt) await verify(provider, address);
      setStep('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup did not complete.');
      setStep('');
    } finally { setBusy(false); }
  }

  if (done) return <div className="ws-wallet-connected" role="status">
    <span className="ws-wallet-dot" aria-hidden="true" />
    <div><strong>Wallet ready · {session!.address.slice(0, 6)}…{session!.address.slice(-4)}</strong>
    <small>On Robinhood Chain · ownership proven {verifiedAt ? new Date(verifiedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : ''}. Nothing more will be asked until you spend.</small></div>
    <button type="button" className="ws-recheck" disabled={disabled || busy}
      onClick={() => shareWalletSession(null)}>Disconnect</button>
  </div>;

  return <div className="ws-wallet-setup">
    <span className="ws-label">YOUR WALLET / ONE SETUP</span>
    <h3>Connect once. Steward handles the rest.</h3>
    <p>One flow: connect, switch to Robinhood Chain, prove the wallet is yours with a free signature. Stock Steward never asks for a private key or recovery phrase.</p>
    {!session
      ? <WalletConnect disabled={disabled || busy} onConnected={() => { setError(''); setStep(''); }} />
      : <button type="button" className="ws-action-primary" onClick={finishSetup} disabled={disabled || busy}>
          {busy ? (step || 'Working…') : !onChain ? 'Finish setup · switch network, then one signature' : 'Finish setup · one free signature'}</button>}
    {busy && step && <p className="ws-chain-note" role="status">{step}</p>}
    {error && <p className="ws-error" role="alert">{error}</p>}
    <ol className="ws-bridge-steps" aria-label="Wallet setup progress">
      {[['Connected', !!session], ['Robinhood Chain', onChain], ['Ownership proven', !!verifiedAt]].map(([label, complete]) =>
        <li key={label as string} className={complete ? 'done' : ''}>
          <span>{complete ? <Check size={13} /> : ''}</span>{label as string}</li>)}
    </ol>
  </div>;
}
