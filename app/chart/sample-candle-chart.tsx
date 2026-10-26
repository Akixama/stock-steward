'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import type {MarketSample} from '@/lib/market-chart';
import {sampledCandles} from '@/lib/market-candles';

type Period='4H'|'12H'|'1D'|'3D'|'7D'|'30D';
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const clock=(time:number,period:Period)=>new Date(time).toLocaleString([],period==='4H'||period==='12H'||period==='1D'?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric'});

// Prices arrive as whole numbers: cents for stocks, micro-dollars for memecoins
// (whose prices are fractions of a cent). format turns them back into dollars.
export default function SampleCandleChart({history,period,symbol,format=money,minPad=25}:{history:MarketSample[];period:Period;symbol:string;format?:(units:number)=>string;minPad?:number}){
 const ref=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:900,height:455}),[hovered,setHovered]=useState<number|null>(null);
 useEffect(()=>{
  const node=ref.current;
  if(!node)return;
  const observer=new ResizeObserver(entries=>{const width=Math.max(280,Math.round(entries[0].contentRect.width)),height=Math.max(280,Math.round(entries[0].contentRect.height));setSize(current=>current.width===width&&current.height===height?current:{width,height});});
  observer.observe(node);
  return()=>observer.disconnect();
 },[]);
 // Hovering a bar updates the tooltip; it should not regroup and sort the
 // entire price history on every pointer move.
 const {candles}=useMemo(()=>sampledCandles(history),[history]);
 const {width,height}=size,left=14,right=76,top=20,bottom=38;
 const plotWidth=Math.max(80,width-left-right),plotHeight=height-top-bottom;
 const [rawMin,rawMax]=useMemo(()=>candles.length?[Math.min(...candles.map(candle=>candle.lowCents)),Math.max(...candles.map(candle=>candle.highCents))]:[0,100],[candles]);
 const pad=Math.max(minPad,Math.round((rawMax-rawMin)*.14));
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
 const tickCount=Math.min(width<520?3:5,candles.length);
 const horizontalTicks=Array.from({length:tickCount},(_,index)=>tickCount===1?0:Math.round((candles.length-1)*index/(tickCount-1)));
 return <div ref={ref} className="market-candles">
  <div className="market-candles-label"><span>PRICE HISTORY</span>{readout&&<span className="market-candle-readout">{clock(readout.startAt,period)} <b>{format(readout.closeCents)}</b></span>}</div>
  <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} price history from periodic checks; prices between checks are not shown`}>
   {[0,1,2,3,4].map(index=>{const value=min+(max-min)*(index/4),vertical=y(value);return <g key={index}><line x1={left} x2={width-right+4} y1={vertical} y2={vertical} stroke="#29292e" strokeWidth="1"/><text x={width-right+9} y={vertical+4} fill="#a8a8b0" fontSize="11" fontFamily="var(--market-mono)">{format(Math.round(value))}</text></g>;})}
   {horizontalTicks.map((candleIndex,index)=>{const candle=candles[candleIndex],horizontal=x(candleIndex);return candle?<g key={candleIndex}><line x1={horizontal} x2={horizontal} y1={top} y2={height-bottom} stroke="#202024" strokeWidth="1"/><text x={horizontal} y={height-12} textAnchor={index===0?'start':index===horizontalTicks.length-1?'end':'middle'} fill="#a0a0aa" fontSize="11" fontFamily="var(--market-mono)">{clock(candle.startAt,period)}</text></g>:null;})}
   {candles.map((candle,index)=>{
    const center=x(index),up=candle.closeCents>candle.openCents,down=candle.closeCents<candle.openCents;
    const color=up?'#37d4a0':down?'#f06472':'#babac4';
    const upper=y(Math.max(candle.openCents,candle.closeCents)),lower=y(Math.min(candle.openCents,candle.closeCents));
    const bodyHeight=Math.max(3,lower-upper);
    return <g key={candle.startAt} onMouseEnter={()=>setHovered(index)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(index)} onBlur={()=>setHovered(null)} tabIndex={0} aria-label={`${clock(candle.startAt,period)}: price ${format(candle.closeCents)}, earlier price ${format(candle.openCents)}`}>
     <line x1={center} x2={center} y1={y(candle.highCents)} y2={y(candle.lowCents)} stroke={color} strokeWidth="2"/>
     <rect x={center-barWidth/2} y={upper-(bodyHeight===3?1.5:0)} width={barWidth} height={bodyHeight} fill={color}/>
     <rect x={center-step/2} y={top} width={step} height={plotHeight} fill="transparent"/>
    </g>;
   })}
   {active&&<g pointerEvents="none"><line x1={x(hovered!)} x2={x(hovered!)} y1={top} y2={height-bottom} stroke="#9b9ba8" strokeWidth="1" strokeDasharray="4 4" opacity=".65"/><line x1={left} x2={width-right+4} y1={y(active.closeCents)} y2={y(active.closeCents)} stroke="#9b9ba8" strokeWidth="1" strokeDasharray="4 4" opacity=".65"/></g>}
   {latest&&<g><line x1={x(candles.length-1)} x2={width-right+4} y1={lastY} y2={lastY} stroke="#b7c4ff" strokeWidth="1" strokeDasharray="3 4" opacity=".7"/><rect x={width-right+5} y={lastY-11} width={right-8} height="22" rx="3" fill="#d6dcff"/><text x={width-right+10} y={lastY+4} fill="#101116" fontSize="11" fontWeight="700" fontFamily="var(--market-mono)">{format(latest.closeCents)}</text></g>}
  </svg>
  {active&&<div className="market-candle-tooltip" style={{left:Math.min(width-188,Math.max(8,x(hovered!)-85))}}><strong>{clock(active.startAt,period)}</strong><span>Price {format(active.closeCents)}</span>{active.openCents!==active.closeCents&&<span>Earlier {format(active.openCents)}</span>}</div>}
 </div>;
}
