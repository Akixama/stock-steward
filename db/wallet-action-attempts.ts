import { keccak256, toHex } from 'viem';

export type WalletAction = {
  owner: string; ownerAddress: string; safe: string; kind: 'sell' | 'transfer';
  symbol: string; quantity: string; amountCents: number;
  transaction: { from: string; to: string; data: string; value: string };
};

export function walletActionId(action: WalletAction) {
  return keccak256(toHex(JSON.stringify({owner:action.owner,kind:action.kind,safe:action.safe.toLowerCase(),symbol:action.symbol,quantity:action.quantity,transaction:action.transaction})));
}

export async function reserveWalletAction(db: D1Database, action: WalletAction, dailyCapCents: number, now = new Date()) {
  if (!Number.isSafeInteger(action.amountCents) || action.amountCents < 0 ||
      !Number.isSafeInteger(dailyCapCents) || dailyCapCents < action.amountCents) return null;
  const id = walletActionId(action), day = now.toISOString().slice(0,10), timestamp = now.toISOString();
  // Reservations count until a definitive revert. Unknown transactions retain
  // their budget. A repeated preparation never creates a second attempt.
  const result = await db.prepare(`INSERT INTO wallet_action_attempts
    (id,owner_ref,owner_address,safe,kind,symbol,quantity,amount_cents,transaction_json,state,execution_day,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,'prepared',?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM wallet_action_attempts WHERE id=?)
      AND NOT EXISTS (SELECT 1 FROM wallet_action_attempts WHERE owner_ref=? AND safe=? AND kind=? AND symbol=? AND state IN ('prepared','submitted','unknown'))
      AND COALESCE((SELECT SUM(amount_cents) FROM wallet_action_attempts WHERE owner_ref=? AND execution_day=? AND state!='reverted'),0)
        +COALESCE((SELECT SUM(amount_cents) FROM autonomy_spends WHERE owner_ref=? AND execution_day=? AND state IN ('reserved','submitted','unknown','confirmed')),0)+?<=?`)
    .bind(id,action.owner,action.ownerAddress.toLowerCase(),action.safe.toLowerCase(),action.kind,action.symbol,action.quantity,action.amountCents,JSON.stringify(action.transaction),day,timestamp,timestamp,id,action.owner,action.safe.toLowerCase(),action.kind,action.symbol,action.owner,day,action.owner,day,action.amountCents,dailyCapCents).run();
  return result.meta.changes===1 ? id : null;
}

export async function latestWalletAction(db: D1Database, owner: string, safe?: string) {
  const statement = safe
    ? db.prepare('SELECT id,safe,kind,symbol,quantity,state,transaction_hash AS hash,created_at AS createdAt FROM wallet_action_attempts WHERE owner_ref=? AND safe=? ORDER BY updated_at DESC LIMIT 1').bind(owner,safe.toLowerCase())
    : db.prepare('SELECT id,safe,kind,symbol,quantity,state,transaction_hash AS hash,created_at AS createdAt FROM wallet_action_attempts WHERE owner_ref=? ORDER BY updated_at DESC LIMIT 1').bind(owner);
  return statement.first<{id:string;safe:string;kind:string;symbol:string;quantity:string;state:string;hash:string|null;createdAt:string}>();
}

export async function walletActionView(db:D1Database,owner:string,safe?:string,kind?:'sell'|'transfer'){
 const scope='owner_ref=? AND (? IS NULL OR safe=?) AND (? IS NULL OR kind=?)';
 const args=[owner,safe?.toLowerCase()??null,safe?.toLowerCase()??null,kind??null,kind??null];
 const latest=await db.prepare(`SELECT id,safe,kind,symbol,quantity,state,transaction_hash AS hash,created_at AS createdAt FROM wallet_action_attempts WHERE ${scope} AND state IN ('prepared','submitted','unknown') AND transaction_hash IS NOT NULL ORDER BY updated_at DESC LIMIT 1`).bind(...args).first();
 const history=await db.prepare(`SELECT id,safe,kind,symbol,quantity,state,transaction_hash AS hash,created_at AS createdAt FROM wallet_action_attempts WHERE ${scope} AND state IN ('confirmed','reverted') AND transaction_hash IS NOT NULL ORDER BY updated_at DESC LIMIT 10`).bind(...args).all();
 return {latest,history:history.results};
}
