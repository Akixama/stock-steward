'use client';
import { useState } from 'react';
import { decodeEventLog, parseAbi } from 'viem';
import type { WalletProvider } from '@/lib/browser-wallet';

// The install driver: one owner-signed transaction at a time, in order, each verified
// onchain before the next is offered. The wallet is the only signer; this component
// never holds a key and never re-sends a transaction whose outcome is unknown.

type Step = { key: string; label: string; to: string; data: string; verify: string };
type Phase = {
  safe: string;
  steps: Step[];
  module?: string;
  checks?: { label: string; expect: string; observed: string; ok: boolean }[];
  installed?: boolean;
  limitations?: string[];
};

const rolesFactoryAbi = parseAbi(['event ModuleProxyCreation(address indexed proxy,address indexed masterCopy,address initializer)']);

export default function InstallDriver({ provider, address, policyVersion }: {
  provider: WalletProvider | null; address: string; policyVersion: number;
}) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [next, setNext] = useState(0);
  const [module, setModule] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const say = (line: string) => setLog((current) => [...current, line]);

  async function waitForReceipt(hash: string): Promise<{ logs: { address: string; topics: string[]; data: string }[]; status: string }> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const receipt = await provider!.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as
        { logs?: { address: string; topics: string[]; data: string }[]; status?: string } | null;
      if (receipt) return { logs: receipt.logs ?? [], status: receipt.status ?? '0x0' };
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Confirmation timed out. Do not re-send; check the transaction in your wallet and retry this step after it lands.');
  }

  async function begin() {
    if (!provider || busy) return;
    setBusy(true); setError(''); setLog([]); setNext(0); setModule('');
    try {
      const response = await fetch('/api/workspace/permission/install', { cache: 'no-store' });
      const payload = await response.json() as Phase & { error?: string };
      if (!response.ok || !payload.steps) throw new Error(payload.error ?? 'Activation unavailable.');
      setPhase(payload);
      say('Phase 1 of 2: create your owner-controlled wallet and the permission module.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation unavailable.');
    } finally { setBusy(false); }
  }

  async function signCurrent() {
    if (!provider || !phase || busy) return;
    const step = phase.steps[next];
    setBusy(true); setError('');
    try {
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: step.to, data: step.data }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash.');
      say(`Sent: ${step.label} (${hash.slice(0, 10)}…) — waiting for confirmation.`);
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== '0x1') throw new Error(`Step reverted onchain: ${step.label}. Nothing further is offered.`);
      say(`Confirmed: ${step.verify}`);
      // The module address is the created proxy in the factory's creation event.
      if (!module) {
        for (const entry of receipt.logs) {
          try {
            const event = decodeEventLog({ abi: rolesFactoryAbi, data: entry.data as `0x${string}`, topics: entry.topics as [] });
            if (event.eventName === 'ModuleProxyCreation') setModule(event.args.proxy as string);
          } catch { /* Not the creation log. */ }
        }
      }
      const isLast = next === phase.steps.length - 1;
      if (isLast && !module && !phase.module) {
        setNext(next + 1);
        say('Module creation event not found in the receipt; the next phase needs the module address.');
      } else if (isLast && phase.steps.length === 2) {
        // Phase A complete: fetch phase B from the server with the observed module.
        setBusy(true);
        const found = module || '';
        const nextResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(found)}`, { cache: 'no-store' });
        const phaseB = await nextResponse.json() as Phase & { error?: string };
        if (!nextResponse.ok || !phaseB.steps) throw new Error(phaseB.error ?? 'Phase 2 assembly unavailable.');
        setPhase(phaseB); setNext(0);
        say('Phase 2 of 2: enable the module and pin your exact limits into it.');
        setBusy(false);
      } else if (isLast) {
        setNext(next + 1);
        setBusy(true);
        const finalResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent((phase.module ?? module))}&inspect=1`, { cache: 'no-store' });
        const final = await finalResponse.json() as Phase & { error?: string };
        if (finalResponse.ok && final.checks) {
          setPhase(final);
          say(final.installed
            ? 'Permission turned on and verified onchain. The policy now enforces your limits.'
            : 'Activation finished but the readback is incomplete. Treat the permission as not verified until every check passes.');
        }
        setBusy(false);
      } else {
        setNext(next + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The step did not complete.');
      say('Stopped. No step is re-sent automatically.');
    } finally { setBusy(false); }
  }

  const current = phase?.steps?.[next];
  return <div className="ws-install-driver">
    <div className="ws-chain-tools">
      <button type="button" className="ws-action-primary" onClick={begin} disabled={busy || !provider || !policyVersion}>
        {phase ? 'Restart activation' : 'Turn on permission (you sign each step)'}
      </button>
      <span>{provider ? 'Each step opens your wallet. Review and sign one at a time.' : 'Connect and verify your wallet above first.'}</span>
    </div>
    {current && <div className="ws-order-plan">
      <span>STEP {next + 1} OF {phase!.steps.length}</span>
      <strong>{current.label}</strong>
      <p>{current.verify}</p>
      <button type="button" className="ws-action-primary" onClick={signCurrent} disabled={busy}>
        {busy ? 'Working…' : `Sign: ${current.label}`}
      </button>
    </div>}
    {phase?.checks && <div className="ws-order-events"><span>ONCHAIN READBACK</span>
      {phase.checks.map((check) => <div key={check.label}><b>{check.ok ? 'PASS' : 'FAIL'} · {check.label}</b>
        <small>expected {check.expect} · observed {check.observed}</small></div>)}</div>}
    {log.length > 0 && <div className="ws-chain-brief"><strong>Activation log</strong>{log.map((line, index) => <p key={index}>{line}</p>)}</div>}
    {error && <p className="ws-error" role="alert">{error}</p>}
  </div>;
}
