import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters} from 'viem';
import {MEMECOINS,isMemecoin,memecoinLimitError,MEMECOIN_MAX_ORDER_CENTS} from './memecoin-list.ts';
import {memecoinQuote,memecoinPriceBound,memecoinTokenPrice,permissionFloorRaw} from './memecoin-price.ts';
import {registry} from './robinhood-chain.ts';
import {parseCandles,change24h,parseTokens} from './memecoin-market.ts';
import {validateAgentSettings} from './ai-agent.ts';

const PONS='0x39dbed3a2bd333467115de45665cc57f813c4571';
const official={assets:[{tokenSymbol:'AAPL',status:'ASSET_STATUS_ACTIVE',currentMultiplier:'1',deployments:[{chainId:4663,contractAddress:'0x'+'a'.repeat(40)}]}]};

test('PONS joins the token list by its checked contract; watch-only coins do not',()=>{
 const tokens=registry(official);
 assert.deepEqual(tokens.find(t=>t.symbol==='PONS'),{symbol:'PONS',contract:PONS,status:'ASSET_STATUS_ACTIVE',multiplier:'1'});
 assert.equal(tokens.some(t=>t.symbol==='MOW'),false);
 // A name the official list already uses is never shadowed.
 const clash=registry({assets:[{tokenSymbol:'PONS',status:'ASSET_STATUS_ACTIVE',deployments:[{chainId:4663,contractAddress:'0x'+'b'.repeat(40)}]}]});
 assert.deepEqual(clash.filter(t=>t.symbol==='PONS').map(t=>t.contract),['0x'+'b'.repeat(40)]);
 assert.ok(MEMECOINS.every(m=>/^0x[0-9a-f]{40}$/.test(m.contract)));
});

test('price comes from a $100 buy and sell in the PONS pool',async()=>{
 // $100 buys 418.94 PONS; selling them back returns $99.40.
 const tokens=418_940000000000000000n,back=99_400000n;
 let calls=0;
 const call=async()=>{calls++;return encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[calls===1?tokens:back,100000n]);};
 const q=await memecoinQuote('PONS',call);
 assert.ok(q);assert.equal(calls,2);
 assert.equal(q.askMicro,238698n);// $0.238698 per PONS, rounded up
 assert.equal(q.bidMicro,237265n);// $0.237265, rounded down
 const bound=await memecoinPriceBound('PONS',async()=>{calls=calls%2;calls++;return encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[calls===1?tokens:back,0n]);});
 assert.ok(bound&&BigInt(bound.lowerMicroUsd)<=BigInt(bound.upperMicroUsd));
 // 1,000 PONS at the midpoint.
 const price=memecoinTokenPrice((1000n*10n**18n).toString(),18,q);
 assert.equal(price.state,'fresh');assert.equal(price.valueMicroUsd,'237981500');
 assert.equal(price.bid,'0.237265');
});

test('no quote, no price: an unreachable pool leaves the coin unpriced',async()=>{
 assert.equal(await memecoinQuote('PONS',async()=>{throw Error('down');}),null);
 assert.equal(await memecoinQuote('MOW',async()=>'0x'),null);
 assert.equal(await memecoinQuote('AAPL',async()=>'0x'),null);
 assert.equal(memecoinTokenPrice('1',18,null).valueMicroUsd,null);
});

test('memecoins get a 5% permission floor; stocks keep their own',()=>{
 assert.equal(permissionFloorRaw('PONS',{best:{outputRaw:'1000000'},minimumOutputRaw:'995000'}),'950000');
 assert.equal(permissionFloorRaw('AAPL',{best:{outputRaw:'1000000'},minimumOutputRaw:'995000'}),'995000');
 assert.equal(permissionFloorRaw('PONS',{best:null,minimumOutputRaw:null}),null);
});

test('a memecoin in the Limits caps every buy at $50',()=>{
 assert.equal(memecoinLimitError(['AAPL'],100000),null);
 assert.equal(memecoinLimitError(['AAPL','PONS'],MEMECOIN_MAX_ORDER_CENTS),null);
 assert.match(memecoinLimitError(['AAPL','PONS'],MEMECOIN_MAX_ORDER_CENTS+1)!,/PONS is a memecoin, so each buy can be at most \$50/);
});

test('the agent never trades memecoins',()=>{
 assert.equal(isMemecoin('PONS'),true);assert.equal(isMemecoin('AAPL'),false);
 assert.throws(()=>validateAgentSettings({version:1,symbols:['PONS'],style:'balanced',intervalMinutes:60,note:''},['PONS','AAPL']),/does not trade memecoins/);
 assert.deepEqual(validateAgentSettings({version:1,symbols:['AAPL'],style:'balanced',intervalMinutes:60,note:''},['PONS','AAPL']).symbols,['AAPL']);
});

test('Markets data: candles sort oldest first and 24h change uses a day-old close',()=>{
 const now=1_800_000_000;
 const points=parseCandles({data:{attributes:{ohlcv_list:[[now,1,1,1,1.2,5],[now-3600*24,1,1,1,1.0,5],[now-3600,1,1,1,'bad',5]]}}});
 assert.deepEqual(points.map(p=>p.c),[1.0,1.2]);
 assert.ok(Math.abs(change24h(points)!-20)<1e-9);
 assert.equal(change24h([{t:0,c:1}]),null);
 const t=parseTokens({data:[{attributes:{address:PONS.toUpperCase(),price_usd:'0.2376',total_reserve_in_usd:'6316068.1',volume_usd:{h24:'11029433.8'},market_cap_usd:null,fdv_usd:'159729128.5'}}]});
 assert.deepEqual(t.get(PONS),{priceUsd:0.2376,liquidityUsd:6316068.1,volume24hUsd:11029433.8,marketCapUsd:159729128.5});
});

test('Markets data falls back to DexScreener price when GeckoTerminal is busy',async()=>{
 const {readMemecoinMarket}=await import('./memecoin-market.ts');
 const seen:string[]=[];
 const fetcher=(async(url:string)=>{seen.push(url);if(url.includes('geckoterminal'))return new Response('busy',{status:429});
  return Response.json([{chainId:'robinhood',baseToken:{address:PONS},priceUsd:'0.2367',priceChange:{h24:-0.8},liquidity:{usd:2237722}},{chainId:'robinhood',baseToken:{address:'0x0b7c6c138dc75622f4200d157b13fb93e6bd94fa'},priceUsd:'0.1011',priceChange:{h24:0.81},liquidity:{usd:10119362}}]);}) as unknown as typeof fetch;
 const r=await readMemecoinMarket(fetcher,undefined,async()=>{});
 assert.equal(r.complete,false);
 // One retry on 429, then DexScreener; no chart calls once GeckoTerminal is busy.
 assert.equal(seen.filter(u=>u.includes('geckoterminal')).length,2);
 const pons=r.rows.find(x=>x.symbol==='PONS')!;
 assert.equal(pons.priceUsd,0.2367);assert.equal(pons.change24hPct,-0.8);
 // DexScreener liquidity is never shown: it can count hooked pools at face value.
 assert.equal(pons.liquidityUsd,null);assert.deepEqual(pons.points,[]);
 await assert.rejects(readMemecoinMarket((async()=>new Response('down',{status:500})) as unknown as typeof fetch,undefined,async()=>{}));
});

test('saved Markets data: one refresh per gap, full copy kept over a backup one, live pool price on top',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');
 const {refreshMemecoinMarket,memecoinMarketView}=await import('./memecoin-feed.ts');
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0045_memecoin_market_cache.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let args:unknown[]=[];const stmt={bind(...v:unknown[]){args=v;return stmt;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};},async first<T>(){return (sql.prepare(query).get(...args as never[]) as T)??null;},async all<T>(){return {results:sql.prepare(query).all(...args as never[]) as T[]};}};return stmt;}} as unknown as D1Database;
 // Before any data: pool price only.
 let view=await memecoinMarketView(db,async s=>s==='PONS'?0.24:null);
 assert.equal(view.source,'none');assert.equal(view.coins[0].priceUsd,0.24);assert.equal(view.coins[0].livePrice,true);assert.equal(view.coins[1].priceUsd,null);
 let calls=0;
 const busy=(async()=>{calls++;return new Response('busy',{status:429});}) as unknown as typeof fetch;
 const t0=new Date('2026-10-26T12:00:00Z');
 assert.match(String((await refreshMemecoinMarket(db,busy,t0)).failed),/429/);
 const before=calls;
 // Within the 2-minute gap nobody calls the APIs again.
 assert.deepEqual(await refreshMemecoinMarket(db,busy,new Date(t0.getTime()+60_000)),{skipped:'recent'});
 assert.equal(calls,before);
 const good=(async(url:string)=>{if(url.includes('/tokens/multi/'))return Response.json({data:[{attributes:{address:PONS,price_usd:'0.2376',total_reserve_in_usd:'6316068',volume_usd:{h24:'1'},market_cap_usd:'159729128'}}]});return Response.json({data:{attributes:{ohlcv_list:[[1792000000,1,1,1,0.25,1],[1792090000,1,1,1,0.24,1]]}}});}) as unknown as typeof fetch;
 assert.deepEqual(await refreshMemecoinMarket(db,good,new Date(t0.getTime()+3*60_000)),{saved:'full'});
 assert.deepEqual(await refreshMemecoinMarket(db,good,new Date(t0.getTime()+6*60_000)),{skipped:'fresh'});
 view=await memecoinMarketView(db,async()=>null,new Date(t0.getTime()+7*60_000));
 assert.equal(view.complete,true);assert.equal(view.coins[0].liquidityUsd,6316068);assert.equal(view.coins[0].points.length,2);assert.equal(view.coins[0].livePrice,false);
 sql.close();
});
