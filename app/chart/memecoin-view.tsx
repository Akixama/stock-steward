'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,ChartLine,ExternalLink,ShieldCheck,TriangleAlert} from 'lucide-react';
import {RouteLink} from '@/components/route-transition';
import type {MemecoinRow} from '@/lib/memecoin-market';

// Memecoins on the Markets page: their own tab in Explore, and the same
// chart area as stocks when one is picked. Display prices only; a buy is
// always quoted on chain when it is reviewed on Home.
export type MemecoinCoin=MemecoinRow&{livePrice?:boolean};
export type MemecoinData={coins:MemecoinCoin[];updatedAt:string|null;maxBuyCents:number;complete?:boolean;source?:string};
type Period='1D'|'3D'|'7D';
const PERIODS:Period[]=['1D','3D','7D'];
const PERIOD_MS:Record<Period,number>={'1D':86400_000,'3D':3*86400_000,'7D':7*86400_000};
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

function MemeChart({points,up}:{points:{t:number;c:number}[];up:boolean}){
 const [hover,setHover]=useState<number|null>(null);
 const W=1000,H=400,PAD=16;
 const min=Math.min(...points.map(p=>p.c)),max=Math.max(...points.map(p=>p.c)),t0=points[0].t,t1=points.at(-1)!.t;
 const x=(t:number)=>t1>t0?(t-t0)/(t1-t0)*W:W/2,y=(c:number)=>max>min?PAD+(1-(c-min)/(max-min))*(H-2*PAD):H/2;
 const line=points.map((p,i)=>`${i?'L':'M'}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join('');
 const stroke=up?'#8fd16a':'#f08a7a';
 const point=hover===null?null:points[hover];
 function move(event:React.PointerEvent<HTMLDivElement>){const box=event.currentTarget.getBoundingClientRect();const t=t0+(event.clientX-box.left)/box.width*(t1-t0);let best=0;for(let i=1;i<points.length;i++)if(Math.abs(points[i].t-t)<Math.abs(points[best].t-t))best=i;setHover(best);}
 return <div className="market-meme-chart" onPointerMove={move} onPointerLeave={()=>setHover(null)}>
  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price from ${usd(points[0].c)} to ${usd(points.at(-1)!.c)}`}>
   <defs><linearGradient id="meme-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity=".22"/><stop offset="1" stopColor={stroke} stopOpacity="0"/></linearGradient></defs>
   <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#meme-fill)"/>
   <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
   {point&&<line x1={x(point.t)} x2={x(point.t)} y1="0" y2={H} stroke="#6f7280" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>}
  </svg>
  <span className="market-meme-axis market-meme-axis-high">{usd(max)}</span><span className="market-meme-axis market-meme-axis-low">{usd(min)}</span>
  {point&&<div className="market-meme-tip" style={{left:`${Math.min(82,Math.max(2,x(point.t)/W*100))}%`}}><strong>{usd(point.c)}</strong><small>{when(point.t)}</small></div>}
 </div>;
}

export function MemecoinCenter({coin,data}:{coin:MemecoinCoin;data:MemecoinData}){
 const [period,setPeriod]=useState<Period>('1D');
 const shown=useMemo(()=>{const end=coin.points.at(-1)?.t??0;return coin.points.filter(p=>end-p.t<=PERIOD_MS[period]);},[coin.points,period]);
 const first=shown[0],last=shown.at(-1),change=first&&last&&shown.length>1?(last.c-first.c)/first.c*100:null;
 const up=(change??coin.change24hPct??0)>=0;
 const low=shown.length?Math.min(...shown.map(p=>p.c)):null,high=shown.length?Math.max(...shown.map(p=>p.c)):null;
 return <section className="market-center" aria-label={`${coin.symbol} memecoin`}>
  <div className="market-instrument"><div className="market-instrument-identity"><CoinMark symbol={coin.symbol} large/><div><div className="market-ticker-row"><h1>{coin.symbol}</h1><span className="market-meme-tag">MEMECOIN · HIGH RISK</span></div><p>{coin.name}</p></div></div></div>
  <div className="market-quote-strip"><div className="market-primary-quote"><span className="market-data-label">PRICE</span><strong>{usd(coin.priceUsd)}</strong></div>
   <div className="market-change" data-direction={change===null||change===0?'none':change>0?'up':'down'}><span className="market-data-label">CHANGE SHOWN · {period}</span><strong>{change===null?'—':`${change>0?'+':''}${change.toFixed(2)}%`}</strong><small>{change===null?'More prices needed':`since ${when(first!.t)}`}</small></div>
   <div className="market-quote-status"><span className="market-data-label">PRICE SOURCE</span><strong><span className={coin.livePrice?'market-live-dot':'market-muted-dot'}/>{coin.livePrice?'Live from its pool':'Saved price'}</strong><small>{coin.livePrice?'On chain, each minute':data.updatedAt?when(Date.parse(data.updatedAt)):'Not saved yet'}</small></div></div>
  <div className="market-chart-toolbar"><div className="market-view-label"><ChartLine size={17}/><span>PRICE HISTORY</span><small>POOL PRICE, EVERY 5 MIN</small></div><div className="market-chart-controls"><div className="market-periods" aria-label="Chart range">{PERIODS.map(value=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value}</button>)}</div></div></div>
  <div className="market-plot">{shown.length>1?<MemeChart points={shown} up={up}/>:<div className="market-plot-empty"><ChartLine size={30}/><strong>Chart is starting</strong><p>Steward saves this coin&apos;s pool price every 5 minutes. The line appears after the next few checks.</p></div>}</div>
  <div className="market-chart-foot"><span>{shown.length>1?`Showing ${when(shown[0].t)} – ${when(shown.at(-1)!.t)}`:'No saved prices for this range yet'}</span><span>Pool mid price, not a trade quote</span></div>
  <div className="market-metrics"><div><span className="market-data-label">LOWEST SHOWN</span><strong>{usd(low)}</strong></div><div><span className="market-data-label">HIGHEST SHOWN</span><strong>{usd(high)}</strong></div><div><span className="market-data-label">LIQUIDITY</span><strong>{compact(coin.liquidityUsd)}</strong></div></div>
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
