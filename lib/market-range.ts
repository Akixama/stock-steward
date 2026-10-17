import type {MarketSample} from './market-chart.ts';

export type MarketRange={
 observations:MarketSample[];
 changes:MarketSample[];
 anchorAt:string|null;
 lastCheckedAt:string|null;
};

// Price checks continue when the quote is unchanged. End the displayed range
// at the latest actual change, then remove repeated checks from its bars.
// The UI always shows when that range ended, so an older range is not passed
// off as a live candlestick feed.
export function selectMarketRange(samples:MarketSample[],durationMs:number):MarketRange{
 const ordered=samples.filter(sample=>Number.isFinite(Date.parse(sample.observedAt))&&Number.isSafeInteger(sample.bidCents)&&sample.bidCents>0)
  .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 if(!ordered.length)return {observations:[],changes:[],anchorAt:null,lastCheckedAt:null};
 let anchorIndex=ordered.length-1;
 for(let index=ordered.length-1;index>0;index--){
  if(ordered[index].bidCents!==ordered[index-1].bidCents){anchorIndex=index;break;}
 }
 const anchor=ordered[anchorIndex];
 const cutoff=Date.parse(anchor.observedAt)-durationMs;
 const observations=ordered.slice(0,anchorIndex+1).filter(sample=>Date.parse(sample.observedAt)>=cutoff);
 const changes=observations.filter((sample,index)=>index===0||sample.bidCents!==observations[index-1].bidCents);
 return {observations,changes,anchorAt:anchor.observedAt,lastCheckedAt:ordered.at(-1)!.observedAt};
}
