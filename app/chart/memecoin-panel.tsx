'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,TriangleAlert} from 'lucide-react';
import {RouteLink} from '@/components/route-transition';
import type {MemecoinRow} from '@/lib/memecoin-market';

type Payload={coins:(MemecoinRow&{livePrice?:boolean})[];updatedAt:string|null;maxBuyCents:number;complete?:boolean;source?:string};
const EXPLORER='https://robinhoodchain.blockscout.com/token/';
function usd(value:number|null){if(value===null)return '—';if(value>=1)return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);return `$${value.toPrecision(4)}`;}
function compact(value:number|null){return value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value);}

function Sparkline({points,up}:{points:MemecoinRow['points'];up:boolean}){
 if(points.length<2)return <div className="market-meme-spark market-meme-spark-empty">No chart yet</div>;
 const w=240,h=56,min=Math.min(...points.map(p=>p.c)),max=Math.max(...points.map(p=>p.c)),t0=points[0].t,t1=points.at(-1)!.t;
 const x=(t:number)=>t1>t0?(t-t0)/(t1-t0)*w:0,y=(c:number)=>max>min?h-4-(c-min)/(max-min)*(h-8):h/2;
 const d=points.map((p,i)=>`${i?'L':'M'}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join('');
 return <svg className="market-meme-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Price over the last 7 days"><path d={d} fill="none" stroke={up?'#8fd16a':'#f08a7a'} strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></svg>;
}

// Hand-checked memecoins, shown apart from stocks. Display prices only: a buy
// is always quoted on chain when you review it on Home.
export default function MemecoinPanel(){
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;fetch('/api/memecoins').then(async r=>{const b=await r.json() as Payload&{error?:string};if(!r.ok)throw Error(b.error??'Memecoin prices are unavailable.');return b;}).then(b=>{if(live)setData(b);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Memecoin prices are unavailable.');});return()=>{live=false;};},[]);
 return <section className="market-meme" aria-label="Memecoins on Robinhood Chain">
  <header><div><span>MEMECOINS · ROBINHOOD CHAIN</span><h2>Memecoins</h2><p>A short list we checked by contract address. Copycat tokens often use the same names, so only these are shown.</p></div></header>
  <p className="market-meme-risk" role="note"><TriangleAlert size={16} aria-hidden="true"/><span><strong>High risk.</strong> Memecoins have no company behind them. Prices can swing wildly and may drop to zero. Buy only what you can lose.</span></p>
  {error&&!data?<p className="market-meme-empty">{error}</p>:!data?<p className="market-meme-empty">Loading memecoins…</p>:<div className="market-meme-grid">{data.coins.map(coin=>{const up=(coin.change24hPct??0)>=0;return <article key={coin.contract} className="market-meme-card">
   <div className="market-meme-top"><div><strong>{coin.symbol}</strong><small>{coin.name}</small></div><span className="market-meme-badge" data-tradable={coin.tradable}>{coin.tradable?'Buy from Home':'Watch only'}</span></div>
   <div className="market-meme-price"><b>{usd(coin.priceUsd)}</b><span data-direction={coin.change24hPct===null?'none':up?'up':'down'}>{coin.change24hPct===null?'—':`${up?'+':''}${coin.change24hPct.toFixed(1)}% 24h`}</span></div>
   <Sparkline points={coin.points} up={up}/>
   <dl><div><dt>Liquidity</dt><dd>{compact(coin.liquidityUsd)}</dd></div><div><dt>24h volume</dt><dd>{compact(coin.volume24hUsd)}</dd></div><div><dt>Market cap</dt><dd>{compact(coin.marketCapUsd)}</dd></div></dl>
   <p className="market-meme-note">{coin.tradable?`Up to $${(data.maxBuyCents/100).toFixed(0)} a buy, by hand only. Add it in Limits first.`:coin.note}</p>
   <div className="market-meme-links">{coin.tradable&&<RouteLink href="/workspace?view=mandate">Add to Limits <ArrowUpRight size={13}/></RouteLink>}<a href={EXPLORER+coin.contract} target="_blank" rel="noreferrer">Contract {coin.contract.slice(0,6)}…{coin.contract.slice(-4)} ↗</a></div>
  </article>;})}</div>}
  <p className="market-meme-foot">{data?`${data.updatedAt&&data.source!=='none'?`Market data from ${data.source}, saved ${new Date(data.updatedAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}.`:'Market data is still loading.'}${data.coins.some(c=>c.livePrice)?` ${data.coins.filter(c=>c.livePrice).map(c=>c.symbol).join(', ')} price is live from its pool on chain.`:''} Display only; your buy is priced on chain when you review it.`:'Display only.'}</p>
 </section>;
}
