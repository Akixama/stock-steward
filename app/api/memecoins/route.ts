import {readMemecoinMarket,type MemecoinRow} from '@/lib/memecoin-market';
import {MEMECOIN_MAX_ORDER_CENTS} from '@/lib/memecoin-list';

// GeckoTerminal's free API allows about 30 calls a minute, so one refresh
// (three calls) is shared for 10 minutes and an older copy is kept for outages.
const FRESH_MS=10*60_000,KEEP_MS=6*3600_000;
let cache:{rows:MemecoinRow[];at:number}|null=null,loading:Promise<MemecoinRow[]>|null=null;

export async function GET(){
 const now=Date.now();
 if(!cache||now-cache.at>FRESH_MS){
  loading??=readMemecoinMarket().then(rows=>{cache={rows,at:Date.now()};return rows;}).finally(()=>{loading=null;});
  try{await loading;}catch{/* Fall back to the saved copy below. */}
 }
 if(!cache||now-cache.at>KEEP_MS)return Response.json({error:'Memecoin prices are unavailable right now.'},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({coins:cache.rows,updatedAt:new Date(cache.at).toISOString(),maxBuyCents:MEMECOIN_MAX_ORDER_CENTS,source:'GeckoTerminal (display only)'},{headers:{'Cache-Control':'public, max-age=120'}});
}
