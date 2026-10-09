'use client';
import { useSyncExternalStore } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';

// One wallet session shared by every workspace panel. Connecting once (Chain,
// Autonomy or anywhere else) is visible everywhere; disconnecting clears it
// everywhere. An account change in the wallet invalidates the session — the
// user must reconnect so no panel keeps acting for a replaced account. A
// network change keeps the session: Steward always observes Robinhood Chain
// server-side regardless of the wallet's selected network.
export type SharedWalletSession = { provider: WalletProvider; address: string } | null;

let session: SharedWalletSession = null;
let detach: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((fn) => fn()); }

export function shareWalletSession(next: SharedWalletSession): void {
  detach?.(); detach = null;
  session = next ? { provider: next.provider, address: next.address } : null;
  if (next) {
    const { provider } = next;
    const dropped = () => shareWalletSession(null);
    provider.on?.('accountsChanged', dropped);
    detach = () => { provider.removeListener?.('accountsChanged', dropped); };
  }
  emit();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => session;

export function useWalletSession(): SharedWalletSession {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
