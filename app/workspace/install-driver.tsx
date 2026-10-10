'use client';
import { useEffect, useState } from 'react';
import { decodeEventLog } from 'viem';
import { rolesFactoryAbi } from '@/lib/roles-permission';
import type { WalletProvider } from '@/lib/browser-wallet';

// The install driver: one owner-signed transaction at a time, in order, each verified
// onchain before the next is offered. The wallet is the only signer; this component
// never holds a key and never re-sends a transaction whose outcome is unknown.

type Step = { key: string; label: string; to: string; data: string; verify: string };
type Phase = {
  safe: string;
  steps: Step[];
  module?: string;
  revocation?: Step;
  checks?: { label: string; expect: string; observed: string; ok: boolean }[];
  installed?: boolean;
  limitations?: string[];
};

export default function InstallDriver({ provider, address, policyVersion, feesOk }: {
  provider: WalletProvider | null; address: string; policyVersion: number; feesOk: boolean;
}) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [next, setNext] = useState(0);
  const [module, setModule] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One-click chaining: after Begin, each confirmed step automatically offers
  // the next signature. Every transaction still pops its own wallet approval,
  // and closing a popup or any failure pauses the chain at once.
  const [chain, setChain] = useState(false);
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
      // Resume first: an earlier attempt may have left a wallet, a module, or a
      // fully verified permission behind. The one candidate is inspected; a
      // verified readback ends the flow, otherwise its steps continue below.
      // Never rebuild what already exists.
      try {
        const checkResponse = await fetch('/api/workspace/permission/install?check=1',
          { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        const check = await checkResponse.json() as { safe?: string; safeHasCode?: boolean; modules?: string[]; staleModule?: string | null };
        if (checkResponse.ok) {
          say(`Onchain state: Steward wallet ${check.safe ?? "unknown"} (${check.safeHasCode ? "exists" : "not created yet"}) · ${(check.modules ?? []).length} module(s) on it${check.staleModule ? " · leftover module found" : ""}.`);
        }
        const candidate = checkResponse.ok
          ? check.staleModule ?? (check.modules?.length === 1 ? check.modules[0] : null)
          : null;
        if (candidate) {
          const inspectResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(candidate)}&inspect=1`, { cache: 'no-store' });
          const inspect = await inspectResponse.json() as Phase & { installed?: boolean; error?: string };
          if (inspectResponse.ok && inspect.checks) {
            setPhase({ ...inspect, steps: inspect.steps ?? [] });
            setModule(candidate);
            if (inspect.installed) {
              setNext((inspect.steps ?? []).length);
              say('Permission already active and verified onchain. Nothing more to sign.');
              return;
            }
            setNext(0);
            say('Continuing with your existing wallet and module. One click signs the remaining steps in order.');
            setChain(true);
            return;
          }
        }
      } catch (checkCause) {
        say(`Prior onchain state could not be read (${checkCause instanceof Error ? checkCause.message : 'network unavailable'}). Building fresh below.`);
      }
      const response = await fetch('/api/workspace/permission/install', { cache: 'no-store' });
      const payload = await response.json() as Phase & { error?: string };
      if (!response.ok || !payload.steps) throw new Error(payload.error ?? 'Activation unavailable.');
      setPhase(payload);
      say('Phase 1 of 2: create your owner-controlled wallet and the permission module.');
      // Pre-flight: the factory must answer, and an already-created wallet is
      // skipped, never re-sent (re-creating it would always fail onchain).
      const codeOf = async (target: string) => {
        try { return await provider.request({ method: 'eth_getCode', params: [target, 'latest'] }) as string; }
        catch { return '0x'; }
      };
      const factoryCode = await codeOf(payload.steps[0].to);
      if (!factoryCode || factoryCode === '0x') {
        throw new Error('The wallet factory is not answering on this network. Confirm Robinhood Chain is selected in your wallet.');
      }
      const safeCode = await codeOf(payload.safe);
      if (safeCode && safeCode !== '0x' && payload.steps.length > 1) {
        setNext(1);
        say('Your Steward wallet already exists onchain, so its creation is skipped. Continue with the next step.');
      }
      say('One click signs each step in order. Closing a wallet popup pauses.');
      setChain(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation unavailable.');
    } finally { setBusy(false); }
  }

  async function signCurrent() {
    if (!provider || !phase || busy) return;
    const step = phase.steps[next];
    if (!step) { setError('No step is waiting. Press Restart activation to check again.'); return; }
    setBusy(true); setError('');
    try {
      // Pre-flight: estimate first so a doomed step never reaches the wallet,
      // and warn plainly when the wallet is short of network fees.
      const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(4);
      const balance = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) as string;
      let estimate = '0x0';
      try {
        estimate = await provider.request({ method: 'eth_estimateGas', params: [{ from: address, to: step.to, data: step.data }] }) as string;
      } catch {
        // Estimation also fails when there is nothing left to do because an
        // earlier attempt already applied everything. Verify onchain first.
        if (phase.module) {
          try {
            const verifyResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(phase.module)}&inspect=1`, { cache: 'no-store' });
            const verify = await verifyResponse.json() as Phase & { installed?: boolean; error?: string };
            if (verifyResponse.ok && verify.checks) {
              setPhase({ ...phase, checks: verify.checks, installed: verify.installed });
              if (verify.installed) {
                setNext(phase.steps.length);
                say('Verified onchain: the permission is already fully active. Nothing more to sign.');
                return;
              }
            }
          } catch { /* Fall through to the step-specific handling below. */ }
        }
        // A failing module creation usually means an earlier attempt already put
        // one onchain. Inspect it: verified means done, otherwise its steps
        // continue below. Either way nothing is rebuilt.
        if (step.key === 'create_module') {
          try {
            const checkResponse = await fetch('/api/workspace/permission/install?check=1',
              { cache: 'no-store', signal: AbortSignal.timeout(25000) });
            const check = await checkResponse.json() as { modules?: string[]; staleModule?: string | null };
            const resumeModule = checkResponse.ok
              ? check.staleModule ?? (check.modules?.length === 1 ? check.modules[0] : null)
              : null;
            if (resumeModule) {
              const inspectResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(resumeModule)}&inspect=1`, { cache: 'no-store' });
              const inspect = await inspectResponse.json() as Phase & { installed?: boolean; error?: string };
              if (inspectResponse.ok && inspect.checks) {
                setPhase({ ...inspect, steps: inspect.steps ?? [] });
                setModule(resumeModule);
                if (inspect.installed) {
                  setNext((inspect.steps ?? []).length);
                  say('Verified onchain: the permission is already fully active. Nothing more to sign.');
                } else {
                  setNext(0);
                  say('A permission module from an earlier attempt is already onchain. Continuing with it instead.');
                }
                return;
              }
            }
          } catch { /* Fall through to the plain message. */ }
        }
        throw new Error('The network expects this step to fail right now, so nothing was sent. If you completed it before, press Restart activation to skip ahead; otherwise try again in a moment.');
      }
      if (!/^0x[0-9a-f]+$/i.test(estimate)) throw new Error('No gas estimate came back. Nothing was sent; try again in a moment.');
      try {
        const gasPrice = await provider.request({ method: 'eth_gasPrice', params: [] }) as string;
        if (/^0x[0-9a-f]+$/i.test(balance) && /^0x[0-9a-f]+$/i.test(gasPrice) &&
          BigInt(balance) < BigInt(estimate) * BigInt(gasPrice)) {
          throw new Error(`Short of network fees: this step needs about ${eth(BigInt(estimate) * BigInt(gasPrice))} ETH but the wallet holds ${eth(BigInt(balance))} ETH. Top up a little ETH and try again. Nothing was sent.`);
        }
      } catch (cause) {
        if (cause instanceof Error && /Short of network fees/.test(cause.message)) throw cause;
        /* Gas price unreadable: let the wallet decide. */
      }
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: step.to, data: step.data }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash.');
      say(`Sent: ${step.label} (${hash.slice(0, 10)}…) — waiting for confirmation.`);
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== '0x1') throw new Error(`Step reverted onchain: ${step.label}. Nothing further is offered.`);
      say(`Confirmed: ${step.verify}`);
      // The module address is the created proxy in the factory's creation event.
      // A local variable, not state: state updates do not apply inside this call,
      // so reading `module` below would always see the old (empty) value.
      let foundModule = module;
      if (!foundModule) {
        for (const entry of receipt.logs) {
          try {
            const event = decodeEventLog({ abi: rolesFactoryAbi, data: entry.data as `0x${string}`, topics: entry.topics as [] });
            if (event.eventName === 'ModuleProxyCreation') {
              foundModule = event.args.proxy as string;
              setModule(foundModule);
            }
          } catch { /* Not the creation log. */ }
        }
      }
      const isLast = next === phase.steps.length - 1;
      if (isLast && !foundModule && !phase.module) {
        setNext(next + 1);
        say('Module creation event not found in the receipt; the next phase needs the module address.');
      } else if (isLast && phase.steps.length === 2) {
        // Phase A complete: fetch phase B from the server with the observed module.
        setBusy(true);
        const found = foundModule || '';
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
          setChain(false);
          say(final.installed
            ? 'Permission turned on and verified onchain. The policy now enforces your limits.'
            : 'Activation finished but the readback is incomplete. Treat the permission as not verified until every check passes.');
        }
        setBusy(false);
      } else {
        setNext(next + 1);
      }
    } catch (cause) {
      setChain(false);
      setError(cause instanceof Error ? cause.message : 'The step did not complete.');
      say('Stopped. No step is re-sent automatically.');
    } finally { setBusy(false); }
  }

  async function killSwitch() {
    if (!provider || !phase?.revocation || busy) return;
    const step = phase.revocation;
    setChain(false);
    setBusy(true); setError('');
    try {
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: step.to, data: step.data }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash.');
      say(`Sent: ${step.label} (${hash.slice(0, 10)}…) — waiting for confirmation.`);
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== '0x1') throw new Error('Revocation reverted onchain. The permission may still be active.');
      say('Confirmed: the spending permission is turned off. Re-activate to grant it again.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The revocation did not complete.');
      say('Stopped. The permission may still be active; verify before relying on it.');
    } finally { setBusy(false); }
  }

  // One-click chaining: whenever a next step waits and nothing is running,
  // offer its signature at once. Failures and pauses switch chaining off.
  useEffect(() => {
    if (chain && !busy && phase?.steps?.[next]) void signCurrent();
  }, [chain, busy, phase, next]);

  const current = phase?.steps?.[next];
  return <div className="ws-install-driver">
    <div className="ws-chain-tools">
      <button type="button" className="ws-action-primary" onClick={begin} disabled={busy || chain || !provider || !policyVersion || !feesOk}>
        {phase ? 'Restart activation' : 'Turn on permission (one click signs each step)'}
      </button>
      {chain && <button type="button" className="ws-action-quiet" onClick={() => setChain(false)}>Pause auto-signing</button>}
      <span>{!provider ? 'Connect and verify your wallet above first.' : !policyVersion ? 'Save your limits in Mandate first.' : !feesOk ? 'Locked until the fee review above passes within your cap.' : 'Each step opens your wallet. Review and sign one at a time.'}</span>
    </div>
    {current && <div className="ws-order-plan">
      <span>STEP {next + 1} OF {phase!.steps.length}</span>
      <strong>{current.label}</strong>
      <p>{current.verify}</p>
      <button type="button" className="ws-action-primary" onClick={() => { setChain(false); void signCurrent(); }} disabled={busy || chain}>
        {busy ? 'Working…' : `Sign: ${current.label}`}
      </button>
    </div>}
    {phase?.revocation && <div className="ws-order-plan">
      <span>KILL SWITCH</span>
      <strong>Turn off the permission</strong>
      <p>Removes the spending permission from your wallet in one signature. Costs a small network fee. Steward cannot undo this for you; re-activate to grant again.</p>
      <button type="button" className="ws-action-primary" onClick={killSwitch} disabled={busy}>
        {busy ? 'Working…' : `Sign: ${phase.revocation.label}`}
      </button>
    </div>}
    {phase?.checks && <div className="ws-order-events"><span>ONCHAIN READBACK</span>
      {phase.checks.map((check) => <div key={check.label}><b>{check.ok ? 'PASS' : 'FAIL'} · {check.label}</b>
        <small>expected {check.expect} · observed {check.observed}</small></div>)}</div>}
    {log.length > 0 && <div className="ws-chain-brief"><strong>Activation update</strong><p>{log[log.length - 1]}</p>
      {log.length > 1 && <details><summary>Earlier updates ({log.length - 1})</summary>{log.slice(0, -1).map((line, index) => <p key={index}>{line}</p>)}</details>}</div>}
    {error && <div className="ws-toast-wrap" role="alert"><div className="ws-toast"><p>{error}</p><button type="button" onClick={() => setError('')}>Dismiss</button></div></div>}
  </div>;
}
