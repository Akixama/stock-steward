// Read-only list of an owner's real wallet actions for the Activity tab.
// It never writes, reserves or changes any attempt.
export type ActivityItem = {
  id: string;
  kind: 'buy' | 'sell' | 'send' | 'idea';
  symbol: string | null;
  amountCents: number | null;
  state: string;
  hash: string | null;
  createdAt: string;
};

const STATE_LABELS: Record<string, string> = {
  reserved: 'Waiting for wallet', attempting: 'Waiting for wallet', prepared: 'Waiting for wallet',
  submitted: 'Sent · checking', unknown: 'Outcome unknown', confirmed: 'Confirmed',
  reverted: 'Failed', released: 'Canceled', proposed: 'Waiting for review', checking: 'Opened in Buy',
  blocked: 'Blocked',
};
export const activityStateLabel = (state: string) => STATE_LABELS[state] ?? state;

export async function ownerActivity(db: D1Database, owner: string, limit = 50): Promise<ActivityItem[]> {
  const [buys, actions, ideas] = await Promise.all([
    db.prepare(`SELECT id, COALESCE(json_extract(plan_json,'$.symbol'), json_extract(plan_json,'$.candidate.symbol')) AS symbol,
        amount_cents, state, transaction_hash, created_at FROM execution_attempts WHERE owner_ref=? ORDER BY created_at DESC LIMIT ?`)
      .bind(owner, limit).all<{ id: string; symbol: string | null; amount_cents: number; state: string; transaction_hash: string | null; created_at: string }>(),
    db.prepare(`SELECT id, kind, symbol, amount_cents, state, transaction_hash, created_at FROM wallet_action_attempts WHERE owner_ref=? ORDER BY created_at DESC LIMIT ?`)
      .bind(owner, limit).all<{ id: string; kind: 'sell' | 'transfer'; symbol: string; amount_cents: number; state: string; transaction_hash: string | null; created_at: string }>(),
    db.prepare(`SELECT id, symbol, amount_cents, status, created_at, expires_at FROM automatic_stage_events WHERE owner_ref=? AND kind='proposal' ORDER BY created_at DESC LIMIT ?`)
      .bind(owner, limit).all<{ id: string; symbol: string; amount_cents: number; status: string; created_at: string; expires_at: string }>(),
  ]);
  const now = Date.now();
  const items: ActivityItem[] = [
    ...buys.results.map(row => ({ id: `buy:${row.id}`, kind: 'buy' as const, symbol: row.symbol, amountCents: row.amount_cents, state: row.state, hash: row.transaction_hash, createdAt: row.created_at })),
    ...actions.results.map(row => ({ id: `${row.kind}:${row.id}`, kind: row.kind === 'sell' ? 'sell' as const : 'send' as const, symbol: row.symbol, amountCents: row.kind === 'sell' ? row.amount_cents : null, state: row.state, hash: row.transaction_hash, createdAt: row.created_at })),
    ...ideas.results.map(row => ({ id: `idea:${row.id}`, kind: 'idea' as const, symbol: row.symbol, amountCents: row.amount_cents,
      state: row.status === 'proposed' && Date.parse(row.expires_at) <= now ? 'expired' : row.status, hash: null, createdAt: row.created_at })),
  ];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
