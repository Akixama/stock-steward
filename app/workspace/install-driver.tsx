'use client';
import { useEffect, useState } from 'react';
import { PermissionStatus } from './permission-design';
import { decodeEventLog, parseAbi } from 'viem';
import { rolesFactoryAbi } from '@/lib/roles-permission';
import type { WalletProvider } from '@/lib/browser-wallet';
import { remainingInstallData } from '@/lib/remaining-install';

const FACTORY = '0x000000000000aDdB49795b0f9bA5BC298cDda236';
const ROLES_MASTER = '0xf2964ce6161ce0e75964fe7927ce114cb0b283d5';
// The factory creation signature, verified against real chain records. The
// proxy and the master copy travel as indexed topics with empty data.
// (Source of truth for the addresses: lib/roles-permission.ts.)
const CREATION_SIG = '0x2150ada912bf189ed721c44211199e270903fc88008c2a1e1e889ef30fe67c5f';

// The install driver: one owner-signed transaction at a time, in order, each verified
// onchain before the next is offered. The wallet is the only signer; this component
// never holds a key and never re-sends a transaction whose outcome is unknown.

type Step = { key: string; label: string; to: string; data: string; verify: string };
type Phase = {
  safe: string;
  steps: Step[];
  batched?: Step;
  module?: string;
  roleKey?: string;
  revocation?: Step;
  checks?: { label: string; expect: string; observed: string; ok: boolean }[];
  installed?: boolean;
  limitations?: string[];
  // The exact prices the steps lock in. Posted back when recording so orders
  // can carry them verbatim; present on steps responses, absent elsewhere.
  outputs?: { token: string; fee: number; tickSpacing: number; minimumOutputRaw: string }[];
};

export default function InstallDriver({ provider, address, policyVersion, feesOk, expires }: {
  provider: WalletProvider | null; address: string; policyVersion: number; feesOk: boolean; expires: string;
}) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [next, setNext] = useState(0);
  const [module, setModule] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingHash, setPendingHash] = useState('');
  // One-click chaining: after Begin, each confirmed step automatically offers
  // the next signature. Every transaction still pops its own wallet approval,
  // and closing a popup or any failure pauses the chain at once.
  const [chain, setChain] = useState(false);
  const [skipBatch, setSkipBatch] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const say = (line: string) => setLog((current) => [...current, line]);

  async function waitForReceipt(hash: string): Promise<{ logs: { address: string; topics: string[]; data: string }[]; status: string }> {
    setPendingHash(hash);
    const deadline = Date.now() + 120000;
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      // Wallet RPC requests can hang indefinitely. Bound each read and use the
      // public chain as a read-only fallback; never re-send a transaction.
      let receipt: { logs?: { address: string; topics: string[]; data: string }[]; status?: string } | null = null;
      try {
        receipt = await Promise.race([provider!.request({ method: 'eth_getTransactionReceipt', params: [hash] }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Wallet read timed out')), 4000))]) as typeof receipt;
      } catch { /* Try an independent read below. */ }
      if (!receipt) {
        try {
          const response = await fetch('https://rpc.mainnet.chain.robinhood.com/', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }) });
          const body = await response.json() as { result?: { logs?: { address: string; topics: string[]; data: string }[]; status?: string } | null };
          receipt = body.result ?? null;
        } catch { /* Unavailable reads do not imply failure or success. */ }
      }
      if (receipt) { setPendingHash(''); return { logs: receipt.logs ?? [], status: receipt.status ?? '0x0' }; }
      if (attempt === 5) say('Still checking confirmation. Your transaction has already been sent; do not submit another.');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Confirmation could not be verified within two minutes. Do not re-send. Check this transaction in your wallet before continuing.');
  }

  // Records a verified module server-side so orders can find it without
  // searching history again. Silent: the wallet scan recovers if it fails.
  async function recordModule(candidate: string, outputs?: Phase['outputs']) {
    try {
      const response = await fetch('/api/workspace/permission/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outputs === undefined ? { module: candidate } : { module: candidate, outputs }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(`Setup confirmed, but its record wasn't saved. ${result.error ?? 'Server unavailable. Try checking permission again.'}`);
      }
      window.dispatchEvent(new Event('steward-permission-updated'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Permission record unavailable.'); }
  }

  // Reads one candidate's live state and continues with it when the readback
  // accepts it. Reports whether the flow was adopted (caller should stop).
  async function adoptModule(candidate: string): Promise<boolean> {
    try {
      const inspectResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(candidate)}&inspect=1`, { cache: 'no-store' });
      const inspect = await inspectResponse.json() as Phase & { installed?: boolean; error?: string };
      if (!inspectResponse.ok || !inspect.checks) return false;
      setPhase({ ...inspect, steps: inspect.steps ?? [] });
      setModule(candidate);
      if (inspect.installed) {
        setNext((inspect.steps ?? []).length);
        say('Permission active. No setup approval needed.');
        void recordModule(candidate);
        return true;
      }
      setNext(0);
      say('Your wallet is ready. Approve the remaining setup once.');
      setChain(true);
      return true;
    } catch { return false; }
  }

  // Searches creation history through the wallet's own connection. The live
  // site's server cannot run this search (its chain provider refuses history
  // searches), so the browser asks directly. Read-only: nothing is sent.
  async function scanLocally(safe: string): Promise<string | null> {
    if (!provider) return null;
    const deadline = Date.now() + 12000;
    const read = async (method: string, params: unknown[]) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('The wallet history check timed out. No setup was offered.');
      return Promise.race([provider.request({ method, params }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The wallet history check timed out. No setup was offered.')), remaining))]);
    };
    try {
      const head = await read('eth_blockNumber', []) as string;
      if (!/^0x[0-9a-f]+$/i.test(head)) throw new Error('The wallet history could not be checked. No setup was offered.');
      const masterTopic = `0x${'0'.repeat(24)}${ROLES_MASTER.slice(2).toLowerCase()}`;
      const safeTail = safe.slice(2).toLowerCase();
      let cursor = BigInt(head);
      let size = 50_000n;
      let scanned = 0n;
      while (scanned < 500_000n && cursor > 0n) {
        const from = cursor - size > 0n ? cursor - size : 0n;
        let logs: { topics?: string[] }[] | null = null;
        try {
          logs = await read('eth_getLogs', [{ address: FACTORY, topics: [CREATION_SIG],
            fromBlock: `0x${from.toString(16)}`, toBlock: `0x${cursor.toString(16)}` }]) as { topics?: string[] }[];
        } catch {
          size = size / 2n;
          if (Date.now() >= deadline || size < 1_000n) throw new Error('The wallet history could not be checked. No setup was offered.');
          continue;
        }
        if (!Array.isArray(logs)) throw new Error('The wallet history returned an invalid response. No setup was offered.');
        const proxies = [...new Set(logs
          .filter((entry) => entry.topics?.[2]?.toLowerCase() === masterTopic)
          .map((entry) => entry.topics?.[1])
          .filter((topic): topic is string => typeof topic === 'string' && /^0x[0-9a-f]{64}$/i.test(topic))
          .map((topic) => `0x${topic.slice(-40)}`))];
        for (const proxy of proxies) {
          try {
            const owner = await read('eth_call', [{ to: proxy, data: '0x8da5cb5b' }, 'latest']) as string;
            if (typeof owner === 'string' && owner.toLowerCase().endsWith(safeTail)) return proxy;
          } catch { throw new Error('An earlier module could not be checked. No setup was offered.'); }
        }
        scanned += cursor - from;
        cursor = from;
        size = 50_000n;
        if (from === 0n) break;
      }
    } catch (cause) { throw cause instanceof Error ? cause : new Error('The wallet history could not be checked. No setup was offered.'); }
    return null;
  }

  async function begin() {
    if (!provider || busy) return;
    setBusy(true); setError(''); setLog([]); setNext(0); setModule(''); setSkipBatch(false);
    try {
      // Resume first: an earlier attempt may have left a wallet, a module, or a
      // fully verified permission behind. The one candidate is inspected; a
      // verified readback ends the flow, otherwise its steps continue below.
      // Never rebuild what already exists.
      try {
        const checkResponse = await fetch('/api/workspace/permission/install?check=1',
          { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        const check = await checkResponse.json() as { safe?: string; safeHasCode?: boolean; modules?: string[]; staleModule?: string | null };
        if (!checkResponse.ok || !check.safe || typeof check.safeHasCode !== 'boolean') throw new Error('Existing wallet state could not be verified. No setup was offered.');
        say(check.safeHasCode ? 'Your Steward wallet is ready. Checking its buying access.' : 'Creating a wallet for these limits. Your earlier holdings stay where they are.');
        const candidate = checkResponse.ok
          ? check.staleModule ?? (check.modules?.length === 1 ? check.modules[0] : null)
          : null;
        if (candidate) {
          if (await adoptModule(candidate)) return;
          throw new Error('An earlier permission was found but could not be verified. No new setup was offered.');
        }
        // The server search came back empty: its chain provider refuses history
        // searches, so look through the wallet's own connection instead.
        if (check.safeHasCode) {
          say('Checking for an earlier setup.');
          const local = await scanLocally(check.safe);
          if (local) {
            if (await adoptModule(local)) return;
            throw new Error('An earlier permission was found but could not be verified. No new setup was offered.');
          }
          say('No earlier setup found for this wallet.');
        }
      } catch (checkCause) {
        throw new Error(checkCause instanceof Error ? checkCause.message : 'Existing wallet state could not be checked. No setup was offered.');
      }
      const response = await fetch('/api/workspace/permission/install', { cache: 'no-store' });
      const payload = await response.json() as Phase & { error?: string };
      if (!response.ok || !payload.steps) throw new Error(payload.error ?? 'Activation unavailable.');
      setPhase(payload);
      say('Setting up your wallet and buying limits.');
      // Pre-flight: the factory must answer, and an already-created wallet is
      // skipped, never re-sent (re-creating it would always fail onchain).
      const codeOf = async (target: string) => {
        const code = await Promise.race([provider.request({ method: 'eth_getCode', params: [target, 'latest'] }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Wallet network check timed out. No setup was offered.')), 8000))]);
        if (typeof code !== 'string' || !/^0x[0-9a-f]*$/i.test(code)) throw new Error('Wallet network check failed. No setup was offered.');
        return code;
      };
      const factoryCode = await codeOf(payload.steps[0].to);
      if (!factoryCode || factoryCode === '0x') {
        throw new Error('The wallet factory is not answering on this network. Confirm Robinhood Chain is selected in your wallet.');
      }
      const safeCode = await codeOf(payload.safe);
      if (safeCode && safeCode !== '0x' && payload.steps.length > 1) {
        setNext(1);
        say('Wallet already exists. Continuing with the next step.');
      }
      say('Review each request in your wallet. You can pause between approvals.');
      setChain(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation unavailable.');
    } finally { setBusy(false); }
  }

  async function signCurrent() {
    if (!provider || !phase || busy) return;
    // The one-signature path: every remaining call rides in a single Safe
    // transaction through the audited batch helper. Same calls, same readback.
    const batchable = !!phase.batched && !skipBatch && next < phase.steps.length;
    const step = batchable ? { ...phase.batched!, label: `Finish ${phase.steps.length - next} setup steps`,
      data: remainingInstallData(phase.batched!.data as `0x${string}`, phase.steps.map(step => step.data as `0x${string}`), next) } : phase.steps[next];
    if (!step) { setError('No step is waiting. Press Restart activation to check again.'); return; }
    setBusy(true); setError('');
    let confirmedOnChain = false;
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
                  say('Found your earlier module. Continuing with it.');
                }
                return;
              }
            }
          } catch { /* Fall through to the plain message. */ }
        }
        throw new Error('The network would reject this step, so nothing was sent. If you did it before, press Restart activation to skip ahead.');
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
      const gate = await fetch('/api/workspace/trading-check', { cache: 'no-store' });
      if (!gate.ok) throw new Error('Trading is paused. No wallet request was made.');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: step.to, data: step.data }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash.');
      say(`${step.label}: sent to Robinhood Chain. Waiting for confirmation.`);
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== '0x1') throw new Error(`Step reverted onchain: ${step.label}. Nothing further is offered.`);
      confirmedOnChain = true;
      say(`${step.label}: confirmed.`);
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
      const isLast = batchable ? true : next === phase.steps.length - 1;
      if (isLast && !foundModule && !phase.module) {
        setNext(next + 1);
        say('The setup transaction confirmed, but its new permission could not be identified. Refresh status before approving anything else.');
      } else if (isLast && phase.steps.length === 2) {
        // Phase A complete: fetch phase B from the server with the observed module.
        setBusy(true);
        const found = foundModule || '';
        const nextResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(found)}`, { cache: 'no-store' });
        const phaseB = await nextResponse.json() as Phase & { error?: string };
        if (!nextResponse.ok || !phaseB.steps) throw new Error(phaseB.error ?? 'Phase 2 assembly unavailable.');
        setPhase(phaseB); setNext(0);
        say('Your wallet is ready. Apply your buying limits next.');
        setBusy(false);
      } else if (isLast) {
        // A confirmed batch completed every remaining call, not one call.
        // Stop chaining before readback so it can never offer another batch.
        setNext(phase.steps.length);
        setChain(false);
        setBusy(true);
        const recorded = phase.module ?? module;
        const finalResponse = await fetch(`/api/workspace/permission/install?module=${encodeURIComponent(recorded)}&inspect=1`, { cache: 'no-store' });
        const final = await finalResponse.json() as Phase & { error?: string };
        if (!finalResponse.ok || !final.checks) throw new Error(final.error ?? 'Final status check unavailable.');
        setPhase(final);
        setChain(false);
        say(final.installed
          ? 'Buying access is on. Your saved limits were checked on Robinhood Chain.'
          : 'The transaction confirmed, but the final checks are incomplete. Refresh status before buying.');
        // `phase` here is still the steps response (state updates do not apply
        // inside this call), so its outputs are the exact prices the signed
        // steps locked in — never the fresh quotes of the inspect above.
        if (final.installed) { await recordModule(recorded, phase.outputs); setLog([]); }
        setBusy(false);
      } else {
        setNext(next + 1);
      }
    } catch (cause) {
      setChain(false);
      setError(confirmedOnChain
        ? 'The transaction confirmed, but the status check did not finish. Press Refresh status. Do not approve the same setup again.'
        : cause instanceof Error ? cause.message : 'The step did not complete.');
      say(confirmedOnChain
        ? 'Transaction confirmed. Status needs another check; nothing will be sent again automatically.'
        : 'Setup paused. Check the message above before trying again. Nothing will be sent automatically.');
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
      const revokedRole = receipt.logs.some(entry => {
        try {
          if (entry.address.toLowerCase() !== phase.module?.toLowerCase()) return false;
          const event = decodeEventLog({ abi: parseAbi(['event AssignRoles(address module,bytes32[] roleKeys,bool[] memberOf)']), data: entry.data as `0x${string}`, topics: entry.topics as [`0x${string}`, ...`0x${string}`[]] });
          return event.args.module.toLowerCase() === address.toLowerCase() && event.args.roleKeys.some((key, index) => key.toLowerCase() === phase.roleKey?.toLowerCase() && event.args.memberOf[index] === false);
        } catch { return false; }
      });
      if (!revokedRole) throw Error('Transaction confirmed, but permission removal could not be verified. Refresh status.');
      setPhase(current => current ? { ...current, installed: false, checks: current.checks?.map(check => check.label === 'Session membership' ? { ...check, expect: 'active', observed: 'revoked', ok: false } : check) } : current);
      setNext(phase.steps.length);
      window.dispatchEvent(new Event('steward-permission-updated'));
      say('Permission turned off. Your balances are unchanged.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The revocation did not complete.');
      say('Stopped. The permission may still be active; verify before relying on it.');
    } finally { setBusy(false); }
  }

  // One-click chaining: whenever a next step waits and nothing is running,
  // offer its signature at once. Failures and pauses switch chaining off.
  useEffect(() => {
    if (!chain || busy || !phase?.steps?.[next]) return;
    const timer = setTimeout(() => void signCurrent(), 0);
    return () => clearTimeout(timer);
  }, [chain, busy, phase, next]);

  const membership = phase?.checks?.find(check => check.label === 'Session membership');
  const revoked = membership?.observed === 'revoked';
  async function refreshStatus() {
    if (!provider || busy) return;
    setBusy(true); setError('');
    try {
      let candidate = phase?.module;
      if (!candidate) {
        const response = await fetch('/api/workspace/permission/install?check=1', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw Error('Permission status unavailable.');
        const check = await response.json() as { staleModule?: string; modules?: string[] };
        candidate = check.staleModule ?? (check.modules?.length === 1 ? check.modules[0] : undefined);
      }
      if (!candidate) return;
      const response = await fetch('/api/workspace/permission/install?module=' + encodeURIComponent(candidate) + '&inspect=1', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const result = await response.json() as Phase & { error?: string };
      if (!response.ok || !result.checks) throw Error(result.error ?? 'Permission status unavailable.');
      setPhase(result); setModule(candidate); setNext(result.steps.length); setChain(false); setLog([]);
      window.dispatchEvent(new Event('steward-permission-updated'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Permission status unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (!provider) return; const timer = setTimeout(() => void refreshStatus(), 0); return () => clearTimeout(timer); }, [provider, address, policyVersion]);
  const current = phase?.steps?.[next];
  const activationState = !provider
    ? { label: 'Disabled', reason: 'Connect and verify your wallet first.' }
    : !policyVersion
      ? { label: 'Disabled', reason: 'Save your buying limits first.' }
      : !feesOk
        ? { label: 'Disabled', reason: 'The fee review has not passed within your cap.' }
        : phase?.installed && !revoked
          ? { label: 'Active', reason: `Permission is active until ${expires}. You still approve each order.` }
          : busy || chain
            ? { label: 'Checking', reason: 'Wait for the current wallet or chain check to finish.' }
            : { label: 'Ready', reason: 'Review the setup in your wallet when you are ready.' };
  return <div className="ws-install-driver">
    <div className="ws-v2-access-state" role="status"><small>ACTIVATION STATUS</small><strong>{activationState.label}</strong><p>{activationState.reason}</p></div>
    {pendingHash && <div className="ws-activation-status" role="status"><span>TRANSACTION SENT</span><strong>{busy ? 'Checking chain confirmation' : 'Confirmation needs checking'}</strong><p>Your wallet has submitted the setup. Do not send it again.</p><code>{pendingHash}</code></div>}
    {phase?.checks && <PermissionStatus checks={phase.checks} installed={phase.installed} revoked={revoked} />}
    <div className="ws-chain-tools permission-actions">
      {!provider ? <button type="button" className="ws-action-primary" onClick={() => document.getElementById('ws-wallet-setup')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })}>Connect wallet to continue</button> : <>
        <button type="button" className="ws-action-primary" onClick={begin} disabled={busy || chain || !policyVersion || !feesOk || phase?.installed}>
          {busy ? 'Checking permission…' : revoked ? 'Reactivate buying permission' : phase?.installed ? 'Permission active' : 'Activate buying permission'}
        </button>
        <button type="button" className="ws-action-quiet" onClick={refreshStatus} disabled={busy || chain}>Refresh status</button>
      </>}
      {phase?.revocation && phase.installed && !revoked && !busy && <button type="button" className="ws-action-revoke" onClick={()=>setConfirmingRevoke(true)}>Revoke permission</button>}
      {chain && !busy && <button type="button" className="ws-action-quiet" onClick={() => setChain(false)}>Pause setup</button>}
      <span>{!provider ? 'Connect on Robinhood Chain and sign a free ownership message. No spending permission is requested yet.' : !policyVersion ? 'Save your limits in Mandate first.' : !feesOk ? 'Locked until the fee review above passes within your cap.' : revoked ? 'Permission is off. New orders are blocked.' : phase?.installed ? `Permission active until ${expires}. You still approve each order.` : 'Not activated yet. Approve setup once in your wallet.'}</span>
    </div>
    {phase?.batched && next < phase.steps.length && !skipBatch ? <div className="ws-order-plan">
      <span>FINAL SETUP · ONE WALLET APPROVAL</span>
      <strong>Turn on buying within your limits</strong>
      <p>{phase!.batched!.verify}</p>
      <button type="button" className="ws-action-primary" onClick={() => { setChain(false); void signCurrent(); }} disabled={busy || chain}>
        {busy ? 'Checking setup…' : 'Review in wallet'}
      </button>
      <button type="button" className="ws-action-quiet" onClick={() => setSkipBatch(true)} disabled={busy}>
        Review each setup step separately
      </button>
    </div> : current && <div className="ws-order-plan">
      <span>STEP {next + 1} OF {phase!.steps.length}</span>
      <strong>{current.label}</strong>
      <p>{current.verify}</p>
      <button type="button" className="ws-action-primary" onClick={() => { setChain(false); void signCurrent(); }} disabled={busy || chain}>
        {busy ? 'Working…' : `Sign: ${current.label}`}
      </button>
      {phase?.batched && <button type="button" className="ws-action-quiet" disabled={busy} onClick={() => { setChain(false); setSkipBatch(false); }}>Finish remaining steps in one approval</button>}
    </div>}
    {confirmingRevoke&&phase?.revocation&&!revoked&&!busy&&<div className="ws-revoke-confirm" role="alertdialog" aria-labelledby="revoke-title"><div><span className="ws-label">CONFIRM</span><strong id="revoke-title">Revoke trading permission?</strong><p>New orders will stop. Your balances stay in the wallet. Your wallet will ask you to approve the revocation and network fee.</p></div><div><button type="button" className="ws-action-revoke" onClick={()=>{setConfirmingRevoke(false);void killSwitch();}}>Revoke permission</button><button type="button" className="ws-action-quiet" onClick={()=>setConfirmingRevoke(false)}>Keep active</button></div></div>}
    {!phase?.installed && log.length > 0 && <div className="ws-chain-brief"><strong>Setup progress</strong><p>{log[log.length - 1]}</p>
      {log.length > 1 && <details><summary>Earlier progress ({log.length - 1})</summary>{log.slice(0, -1).map((line, index) => <p key={index}>{line}</p>)}</details>}</div>}
    {error && <div className="ws-toast-wrap" role="alert"><div className="ws-toast"><p>{error}</p><button type="button" onClick={() => setError('')}>Dismiss</button></div></div>}
  </div>;
}
