import type {MarketSample} from './market-chart.ts';

export type SampleCandle={
 startAt:number;endAt:number;openCents:number;highCents:number;lowCents:number;closeCents:number;observations:number;
};

export function sampledCandles(samples:MarketSample[]):{candles:SampleCandle[];intervalMs:number}{
 const ordered=samples.filter(sample=>Number.isFinite(Date.parse(sample.observedAt))&&Number.isSafeInteger(sample.bidCents)&&sample.bidCents>0)
  .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 if(!ordered.length)return {candles:[],intervalMs:15*60_000};
 const first=Date.parse(ordered[0].observedAt),last=Date.parse(ordered.at(-1)!.observedAt);
 const targetBars=Math.min(36,Math.max(1,Math.ceil(ordered.length/2)));
 const intervalMs=Math.max(60_000,Math.ceil(Math.max(60_000,last-first)/targetBars/60_000)*60_000);
 const candles:SampleCandle[]=[];
 for(const sample of ordered){
  const time=Date.parse(sample.observedAt);
  const startAt=Math.floor(time/intervalMs)*intervalMs;
  const candle=candles.at(-1);
  if(candle?.startAt===startAt){
   candle.endAt=time;
   candle.highCents=Math.max(candle.highCents,sample.bidCents);
   candle.lowCents=Math.min(candle.lowCents,sample.bidCents);
   candle.closeCents=sample.bidCents;
   candle.observations++;
  }else candles.push({startAt,endAt:time,openCents:sample.bidCents,highCents:sample.bidCents,lowCents:sample.bidCents,closeCents:sample.bidCents,observations:1});
 }
 return {candles,intervalMs};
}

export function candleIntervalLabel(intervalMs:number){
 if(intervalMs<60*60_000)return `${Math.round(intervalMs/60_000)}m`;
 if(intervalMs<24*60*60_000)return `${Math.round(intervalMs/(60*60_000))}h`;
 return `${Math.round(intervalMs/(24*60*60_000))}d`;
}
