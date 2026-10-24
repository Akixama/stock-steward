// Read-only activity since a wallet value check, for the "max in one stock" buy check.
const SYMBOL = "COALESCE(json_extract(plan_json,'$.route.symbol'), json_extract(plan_json,'$.symbol'))";

/** $ of this stock bought (pending or confirmed) from this Steward wallet since a time. */
export async function buysSinceCents(db: D1Database, owner: string, safe: string, symbol: string, since: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM execution_attempts WHERE owner_ref=? AND lower(address)=lower(?) AND created_at>=? AND state NOT IN ('released','reverted') AND ${SYMBOL}=?`)
    .bind(owner, safe, since, symbol).first<{ cents: number }>();
  return Number(row?.cents ?? 0);
}

/** True when a sale or send from this Steward wallet happened since a time (the saved total may be too high). */
export async function outflowSince(db: D1Database, owner: string, safe: string, since: string): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM wallet_action_attempts WHERE owner_ref=? AND lower(safe)=lower(?) AND created_at>=? AND state!='reverted'")
    .bind(owner, safe, since).first<{ n: number }>();
  return Number(row?.n ?? 0) > 0;
}
