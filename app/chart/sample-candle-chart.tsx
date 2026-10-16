'use client';

import {useEffect,useRef,useState} from 'react';
import type {MarketSample} from '@/lib/market-chart';
import {candleIntervalLabel,sampledCandles} from '@/lib/market-candles';

type Period='1D'|'7D'|'30D';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const clock=(time:number,period:Period)=>new Date(time).toLocaleString([],period==='1D'?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric'});

export default function SampleCandleChart({history,period,symbol}:{history:MarketSample[];period:Period;symbol:string}){
 const ref=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:900,height:455}),[hovered,setHovered]=useState<number|null>(null);
 useEffect(()=>{
  const node=ref.current;
  if(!node)return;
  const observer=new ResizeObserver(entries=>setSize({width:Math.max(280,Math.round(entries[0].contentRect.width)),height:Math.max(280,Math.round(entries[0].contentRect.height))}));
  observer.observe(node);
  return()=>observer.disconnect();
 },[]);
 const {candles,intervalMs}=sampledCandles(history);
 const {width,height}=size,left=14,right=76,top=20,bottom=38;
 const plotWidth=Math.max(80,width-left-right),plotHeight=height-top-bottom;
 const values=candles.flatMap(candle=>[candle.highCents,candle.lowCents]);
 const rawMin=values.length?Math.min(...values):0,rawMax=values.length?Math.max(...values):100;
 const pad=Math.max(25,Math.round((rawMax-rawMin)*.14));
 const min=rawMin-pad,max=rawMax+pad;
 // Place recorded candles in observation order. Empty clock intervals have no
 // quotes, so stretching them across the plot suggests data we do not have.
 const step=plotWidth/Math.max(1,candles.length);
 const x=(index:number)=>left+(index+.5)*step;
 const y=(cents:number)=>top+((max-cents)/(max-min))*plotHeight;
 const barWidth=Math.max(2,Math.min(24,step-1.5));
 const active=hovered===null?null:candles[hovered];
 const latest=candles.at(-1);
 const readout=active??latest;
 const lastY=latest?y(latest.closeCents):0;
 const horizontalTicks=width<520?[0,2,4]:[0,1,2,3,4];
 return <div ref={ref} className="market-candles">
  <div className="market-candles-label"><span>{candles.length} BARS · {history.length} SAVED BIDS · {candleIntervalLabel(intervalMs)} BUCKETS</span>{readout&&<span className="market-candle-readout">START {money(readout.openCents)} <b>HIGH {money(readout.highCents)}</b> LOW {money(readout.lowCents)} <b>LAST {money(readout.closeCents)}</b></span>}</div>
  <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} sampled bid movement chart with ${candles.length} bars in observation order; each bar starts at the previous saved bid and empty time intervals are compressed`}>
   {[0,1,2,3,4].map(index=>{const value=min+(max-min)*(index/4),vertical=y(value);return <g key={index}><line x1={left} x2={width-right+4} y1={vertical} y2={vertical} stroke="#29292e" strokeWidth="1"/><text x={width-right+9} y={vertical+4} fill="#a8a8b0" fontSize="11" fontFamily="var(--market-mono)">{money(Math.round(value))}</text></g>;})}
   {horizontalTicks.map(index=>{const candleIndex=Math.min(candles.length-1,Math.round((candles.length-1)*index/4)),candle=candles[candleIndex],horizontal=x(candleIndex);return candle?<g key={index}><line x1={horizontal} x2={horizontal} y1={top} y2={height-bottom} stroke="#202024" strokeWidth="1"/><text x={horizontal} y={height-12} textAnchor={index===0?'start':index===4?'end':'middle'} fill="#a0a0aa" fontSize="11" fontFamily="var(--market-mono)">{clock(candle.startAt,period)}</text></g>:null;})}
   {candles.map((candle,index)=>{
    const center=x(index),up=candle.closeCents>candle.openCents,down=candle.closeCents<candle.openCents;
    const color=up?'#37d4a0':down?'#f06472':'#babac4';
    const upper=y(Math.max(candle.openCents,candle.closeCents)),lower=y(Math.min(candle.openCents,candle.closeCents));
    const bodyHeight=Math.max(3,lower-upper);
    return <g key={candle.startAt} onMouseEnter={()=>setHovered(index)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(index)} onBlur={()=>setHovered(null)} tabIndex={0} aria-label={`${clock(candle.startAt,period)}: previous saved bid ${money(candle.openCents)}, observed high ${money(candle.highCents)}, observed low ${money(candle.lowCents)}, latest saved bid ${money(candle.closeCents)}; ${candle.observations} ${candle.observations===1?'observation':'observations'}`}>
     <line x1={center} x2={center} y1={y(candle.highCents)} y2={y(candle.lowCents)} stroke={color} strokeWidth="2"/>
     <rect x={center-barWidth/2} y={upper-(bodyHeight===3?1.5:0)} width={barWidth} height={bodyHeight} fill={color}/>
     <rect x={center-step/2} y={top} width={step} height={plotHeight} fill="transparent"/>
    </g>;
   })}
   {active&&<g pointerEvents="none"><line x1={x(hovered!)} x2={x(hovered!)} y1={top} y2={height-bottom} stroke="#9b9ba8" strokeWidth="1" strokeDasharray="4 4" opacity=".65"/><line x1={left} x2={width-right+4} y1={y(active.closeCents)} y2={y(active.closeCents)} stroke="#9b9ba8" strokeWidth="1" strokeDasharray="4 4" opacity=".65"/></g>}
   {latest&&<g><line x1={x(candles.length-1)} x2={width-right+4} y1={lastY} y2={lastY} stroke="#b7c4ff" strokeWidth="1" strokeDasharray="3 4" opacity=".7"/><rect x={width-right+5} y={lastY-11} width={right-8} height="22" rx="3" fill="#d6dcff"/><text x={width-right+10} y={lastY+4} fill="#101116" fontSize="11" fontWeight="700" fontFamily="var(--market-mono)">{money(latest.closeCents)}</text></g>}
  </svg>
  {active&&<div className="market-candle-tooltip" style={{left:Math.min(width-188,Math.max(8,x(hovered!)-85))}}><strong>{clock(active.startAt,period)} · {active.observations} {active.observations===1?'sample':'samples'}</strong><span>Previous {money(active.openCents)} · High {money(active.highCents)}</span><span>Low {money(active.lowCents)} · Last {money(active.closeCents)}</span></div>}
 </div>;
}
