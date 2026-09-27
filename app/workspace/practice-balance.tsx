'use client';
import {useEffect,useRef,useState} from 'react';
export default function PracticeBalance({cents}:{cents:number}){const previous=useRef(cents),[shown,setShown]=useState(cents);
 useEffect(()=>{const from=previous.current;previous.current=cents;if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setShown(cents);return;}const start=performance.now();let frame=0;const tick=(now:number)=>{const t=Math.min(1,(now-start)/500);setShown(Math.round(from+(cents-from)*(1-Math.pow(1-t,3))));if(t<1)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[cents]);
 return <strong className="ws-practice-balance" aria-label={'$'+(cents/100).toFixed(2)}><span aria-hidden="true">{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(shown/100)}</span></strong>;
}
