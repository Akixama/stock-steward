// Only terminal records produced by trusted finalized reconciliation can be
// reused. Unresolved attempts must still obtain fresh chain evidence.
export function savedOrderReceipt(attempt: { state: string; transaction_hash: string | null; amount_cents: number }) {
  if (!['confirmed', 'reverted'].includes(attempt.state)
    || !/^0x[0-9a-f]{64}$/i.test(attempt.transaction_hash ?? '')
    || !Number.isSafeInteger(attempt.amount_cents) || attempt.amount_cents < 1) return null;
  const filled = attempt.state === 'confirmed';
  return { outcome: filled ? 'verified_fill' as const : 'reverted' as const,
    confirmedFill: filled, transactionSucceeded: filled, awaitingFinality: false,
    hash: attempt.transaction_hash,
    paidUsdg: filled ? `$${(attempt.amount_cents / 100).toFixed(2)}` : null,
    receivedNote: filled ? 'Stock tokens arrived in your Steward wallet. The finalized proof is recorded.' : null,
    why: filled ? 'Exact transaction and token transfers were verified in a finalized block; this receipt is saved.'
      : 'The finalized transaction reverted. No stock arrived; network fees may still have been spent.' };
}
