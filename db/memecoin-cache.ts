import type {MemecoinRow} from '../lib/memecoin-market.ts';
// One row per kind: 'full' (GeckoTerminal: price, liquidity, chart) and
// 'partial' (DexScreener backup: price and 24h change only).
export type CachedMarket={rows:MemecoinRow[];complete:boolean;updatedAt:string};
type Row={id:string;payload:string;complete:number;updated_at:string;attempted_at:string};

export async function readMemecoinCache(db:D1Database){
 const rows=(await db.prepare("SELECT * FROM memecoin_market_cache WHERE id IN ('full','partial','attempt')").all<Row>()).results??[];
 const parse=(r?:Row):CachedMarket|null=>{if(!r)return null;try{return {rows:JSON.parse(r.payload) as MemecoinRow[],complete:r.complete===1,updatedAt:r.updated_at};}catch{return null;}};
 return {full:parse(rows.find(r=>r.id==='full')),partial:parse(rows.find(r=>r.id==='partial')),attemptedAt:rows.find(r=>r.id==='attempt')?.attempted_at??null};
}

// Claims the right to call the price APIs. Compare-and-set on the attempt time,
// so overlapping page views and background checks make one call at most.
export async function claimMemecoinRefresh(db:D1Database,seen:string|null,now=new Date()){
 const at=now.toISOString();
 const result=seen===null
  ?await db.prepare("INSERT OR IGNORE INTO memecoin_market_cache(id,payload,complete,updated_at,attempted_at) VALUES('attempt','[]',0,?,?)").bind(at,at).run()
  :await db.prepare("UPDATE memecoin_market_cache SET attempted_at=? WHERE id='attempt' AND attempted_at=?").bind(at,seen).run();
 return result.meta.changes===1;
}

export async function saveMemecoinCache(db:D1Database,rows:MemecoinRow[],complete:boolean,now=new Date()){
 const at=now.toISOString(),id=complete?'full':'partial';
 await db.prepare('INSERT INTO memecoin_market_cache(id,payload,complete,updated_at,attempted_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,complete=excluded.complete,updated_at=excluded.updated_at,attempted_at=excluded.attempted_at')
  .bind(id,JSON.stringify(rows),complete?1:0,at,at).run();
}
