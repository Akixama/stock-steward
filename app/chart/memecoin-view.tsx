'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,ChartCandlestick,ExternalLink,ShieldCheck,TriangleAlert} from 'lucide-react';
import SampleCandleChart from './sample-candle-chart';
import {selectMarketRange} from '@/lib/market-range';
import type {MarketSample} from '@/lib/market-chart';
import {RouteLink} from '@/components/route-transition';
import type {MemecoinRow} from '@/lib/memecoin-market';

// Memecoins on the Markets page: their own tab in Explore, and the same
// chart area as stocks when one is picked. Display prices only; a buy is
// always quoted on chain when it is reviewed on Home.
export type MemecoinCoin=MemecoinRow&{livePrice?:boolean};
export type MemecoinData={coins:MemecoinCoin[];updatedAt:string|null;maxBuyCents:number;complete?:boolean;source?:string};
type Period='4H'|'12H'|'1D'|'3D'|'7D'|'30D';
const PERIODS:Period[]=['4H','12H','1D','3D','7D','30D'];
const PERIOD_MS:Record<Period,number>={'4H':4*3600_000,'12H':12*3600_000,'1D':86400_000,'3D':3*86400_000,'7D':7*86400_000,'30D':30*86400_000};
const EXPLORER='https://robinhoodchain.blockscout.com/token/';

export function usd(value:number|null|undefined){if(value===null||value===undefined)return '—';if(value>=1)return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);return `$${value.toPrecision(4)}`;}
const compact=(value:number|null)=>value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);
const when=(t:number)=>new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function useMemecoins(){
 const [data,setData]=useState<MemecoinData|null>(null),[error,setError]=useState(''),[tick,setTick]=useState(0);
 useEffect(()=>{const timer=window.setInterval(()=>setTick(v=>v+1),60_000);return()=>window.clearInterval(timer);},[]);
 useEffect(()=>{let live=true;fetch('/api/memecoins',{cache:'no-store'}).then(async r=>{const b=await r.json() as MemecoinData&{error?:string};if(!r.ok)throw Error(b.error??'Memecoin prices are unavailable.');return b;}).then(b=>{if(live){setData(b);setError('');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Memecoin prices are unavailable.');});return()=>{live=false;};},[tick]);
 return {data,error};
}

function CoinMark({symbol,large=false}:{symbol:string;large?:boolean}){
 return <span className={`market-asset-icon market-meme-icon${large?' market-asset-icon-large':''}`} aria-hidden="true"><span className="market-asset-fallback">{symbol.slice(0,1)}</span></span>;
}

export function MemecoinList({data,error,search,selected,onSelect}:{data:MemecoinData|null;error:string;search:string;selected:string|null;onSelect:(symbol:string)=>void}){
 if(!data)return <p className="market-list-empty">{error||'Loading memecoins…'}</p>;
 const coins=data.coins.filter(c=>!search||c.symbol.toLowerCase().includes(search)||c.name.toLowerCase().includes(search));
 return <>
  <p className="market-meme-list-note"><TriangleAlert size={13} aria-hidden="true"/> High risk. Checked by contract address.</p>
  {coins.length?coins.map(c=><button type="button" className="market-list-item" aria-pressed={selected===c.symbol} key={c.contract} onClick={()=>onSelect(c.symbol)}><CoinMark symbol={c.symbol}/><span className="market-list-name"><strong>{c.symbol}</strong><small>{c.name} · {c.tradable?'Buy from Home':'Watch only'}</small></span><span className="market-list-price">{usd(c.priceUsd)}{c.change24hPct!==null&&<small data-direction={c.change24hPct>=0?'up':'down'} className="market-meme-list-change">{c.change24hPct>=0?'+':''}{c.change24hPct.toFixed(1)}%</small>}</span></button>):<p className="market-list-empty">No matching memecoins.</p>}
 </>;
}

// Same chart as stocks: prices go in as whole micro-dollars so a $0.24 coin keeps
// its exact moves instead of rounding to whole cents.
const PERIOD_LABELS:Record<Period,string>={'4H':'4 hours','12H':'12 hours','1D':'1 day','3D':'3 days','7D':'7 days','30D':'30 days'};
// Enough whole units for five significant digits: micro-dollars for $0.24, finer for $0.0001.
const scaleFor=(points:{c:number}[])=>{const top=Math.max(1e-12,...points.map(p=>p.c));return 10**Math.min(12,Math.max(6,Math.ceil(5-Math.log10(top))));};
const toSamples=(symbol:string,points:{t:number;c:number}[],scale:number):MarketSample[]=>points.map(p=>{const units=Math.max(1,Math.round(p.c*scale));return {symbol,observedAt:new Date(p.t).toISOString(),bidCents:units,askCents:units};});

export function MemecoinCenter({coin,data}:{coin:MemecoinCoin;data:MemecoinData}){
 const [period,setPeriod]=useState<Period>('1D');
 const scale=useMemo(()=>scaleFor(coin.points),[coin.points]);
 const samples=useMemo(()=>toSamples(coin.symbol,coin.points,scale),[coin.symbol,coin.points,scale]);
 const fromUnits=useMemo(()=>(units:number)=>usd(units/scale),[scale]);
 const range=useMemo(()=>selectMarketRange(samples,PERIOD_MS[period]),[samples,period]);
 const history=range.changes;
 const first=history[0],last=history.at(-1),change=first&&last&&history.length>1?(last.bidCents-first.bidCents)/first.bidCents*100:null;
 const bids=history.map(p=>p.bidCents),low=bids.length?Math.min(...bids):null,high=bids.length?Math.max(...bids):null;
 const minPad=Math.max(1,Math.round((last?.bidCents??1)*0.002));
 return <section className="market-center" aria-label={`${coin.symbol} memecoin`}>
  <div className="market-instrument"><div className="market-instrument-identity"><CoinMark symbol={coin.symbol} large/><div><div className="market-ticker-row"><h1>{coin.symbol}</h1><span className="market-meme-tag">MEMECOIN · HIGH RISK</span></div><p>{coin.name}</p></div></div></div>
  <div className="market-quote-strip"><div className="market-primary-quote"><span className="market-data-label">PRICE</span><strong>{usd(coin.priceUsd)}</strong></div>
   <div className="market-change" data-direction={change===null||change===0?'none':change>0?'up':'down'}><span className="market-data-label">CHANGE SHOWN · {period}</span><strong>{change===null?'—':`${change>0?'+':''}${change.toFixed(2)}%`}</strong><small>{change===null?'More prices needed':`since ${when(Date.parse(first!.observedAt))}`}</small></div>
   <div className="market-quote-status"><span className="market-data-label">PRICE SOURCE</span><strong><span className={coin.livePrice?'market-live-dot':'market-muted-dot'}/>{coin.livePrice?'Live from its pool':'Saved price'}</strong><small>{coin.livePrice?'Pool price, each minute':data.updatedAt?when(Date.parse(data.updatedAt)):'Not saved yet'}</small></div></div>
  <div className="market-chart-toolbar"><div className="market-view-label"><ChartCandlestick size={17}/><span>PRICE HISTORY</span><small>POOL PRICE, EVERY 5 MIN</small></div><div className="market-chart-controls"><div className="market-periods" aria-label="Chart range">{PERIODS.map(value=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)} aria-label={`${PERIOD_LABELS[value]} of price history`}>{value}</button>)}</div></div></div>
  <div className="market-plot">{history.length>1?<SampleCandleChart history={history} period={period} symbol={coin.symbol} format={fromUnits} minPad={minPad}/>:<div className="market-plot-empty"><ChartCandlestick size={30}/><strong>{samples.length?'Not enough prices for this range yet':'Chart is starting'}</strong><p>Steward saves this coin&apos;s pool price every 5 minutes. Try a longer range, or check back soon.</p></div>}</div>
  <div className="market-chart-foot"><span>{range.observations.length?`Showing ${when(Date.parse(range.observations[0].observedAt))} – ${when(Date.parse(range.anchorAt!))} of saved prices`:'No saved prices for this range yet'}</span><span>Pool mid price, not a trade quote</span></div>
  <div className="market-metrics"><div><span className="market-data-label">LOWEST SHOWN</span><strong>{low!==null?fromUnits(low):'—'}</strong></div><div><span className="market-data-label">HIGHEST SHOWN</span><strong>{high!==null?fromUnits(high):'—'}</strong></div><div><span className="market-data-label">LIQUIDITY</span><strong>{compact(coin.liquidityUsd)}</strong></div></div>
 </section>;
}

export function MemecoinContext({coin,maxBuyCents}:{coin:MemecoinCoin;maxBuyCents:number}){
 return <aside className="market-context" aria-label={`${coin.symbol} details`}>
  <div className="market-context-top"><span className="market-data-label">MEMECOIN DETAILS</span><h2>{coin.symbol} <span>at a glance</span></h2>
   <p className="market-meme-risk" role="note"><TriangleAlert size={16} aria-hidden="true"/><span><strong>High risk.</strong> Memecoins have no company behind them. Prices can swing wildly and may drop to zero. Copycat tokens use the same names; this one is checked by contract.</span></p>
   <div className="market-context-quotes market-meme-stats"><div><span>24H VOLUME</span><strong>{compact(coin.volume24hUsd)}</strong></div><div><span>MARKET CAP</span><strong>{compact(coin.marketCapUsd)}</strong></div></div>
   <div className="market-context-updated"><span>CONTRACT</span><strong><a href={EXPLORER+coin.contract} target="_blank" rel="noreferrer">{coin.contract.slice(0,6)}…{coin.contract.slice(-4)} <ExternalLink size={12}/></a></strong></div>
   <p className="market-context-quote-note">{coin.note}</p></div>
  <div className="market-context-actions"><div className="market-context-action-icon"><ShieldCheck size={18}/></div><span className="market-data-label">YOUR NEXT MOVE</span>
   {coin.tradable?<><h3>Buy it yourself, small.</h3><p>Add {coin.symbol} in Limits, then buy from Home. Up to ${(maxBuyCents/100).toFixed(0)} a buy, by hand only: no automatic rules, no agent trades.</p><RouteLink href="/workspace?view=mandate" className="market-buy-link">Add {coin.symbol} to Limits <ArrowRight size={16}/></RouteLink></>
    :<><h3>Watch only for now.</h3><p>{coin.note}</p></>}
   <div className="market-context-safe"><ShieldCheck size={15}/> You approve every purchase in your wallet</div></div>
 </aside>;
}
