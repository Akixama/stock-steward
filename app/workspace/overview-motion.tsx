'use client';
import {useEffect,useRef} from 'react';
export default function OverviewMotion(){
 const root=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
  const view=root.current?.closest('.ws-view');if(!view||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const seen=new WeakSet<Element>(),animations=new Set<Animation>();let frame=0;let highlighted:HTMLElement|null=null;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const el=entry.target as HTMLElement;observer.unobserve(el);el.style.opacity='';if(view.getAttribute('data-animate')==='false')continue;const animation=el.animate([{opacity:0,transform:'translateY(16px) scale(.99)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:280,easing:'cubic-bezier(.23,1,.32,1)'});animations.add(animation);animation.finished.then(()=>animations.delete(animation)).catch(()=>{});}},{threshold:.01,rootMargin:'0px 0px -20px 0px'});
  const scan=()=>{view.querySelectorAll<HTMLElement>('.ws-chain-panel,.ws-autonomy-panel,.ws-overview-grid>section,.ws-account-numbers>div,.ws-overview-trail,.ws-chain-holdings>details').forEach(el=>{if(seen.has(el))return;seen.add(el);el.classList.add('ws-motion-card');if(el.getBoundingClientRect().top>window.innerHeight)el.style.opacity='0';observer.observe(el);});};scan();
  const changes=new MutationObserver(scan);changes.observe(view,{childList:true,subtree:true});
  const move=(event:Event)=>{const e=event as PointerEvent;if(e.pointerType!=='mouse')return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const el=(e.target as Element).closest<HTMLElement>('.ws-motion-card');if(highlighted!==el)highlighted?.removeAttribute('data-lit');highlighted=el;if(!el)return;const rect=el.getBoundingClientRect();el.style.setProperty('--pointer-x',((e.clientX-rect.left)/rect.width*100)+'%');el.style.setProperty('--pointer-y',((e.clientY-rect.top)/rect.height*100)+'%');el.setAttribute('data-lit','true');});};
  const leave=()=>{highlighted?.removeAttribute('data-lit');};view.addEventListener('pointermove',move);view.addEventListener('pointerleave',leave);
  return()=>{observer.disconnect();changes.disconnect();cancelAnimationFrame(frame);animations.forEach(a=>a.cancel());view.removeEventListener('pointermove',move);view.removeEventListener('pointerleave',leave);view.querySelectorAll<HTMLElement>('.ws-motion-card').forEach(el=>{el.style.opacity='';el.removeAttribute('data-lit');});};
 },[]);
 return <div ref={root} className="ws-overview-orbit" aria-hidden="true"><div className="ws-orbit-halo"/><svg viewBox="0 0 240 160"><ellipse cx="120" cy="80" rx="96" ry="46"/><ellipse cx="120" cy="80" rx="66" ry="66"/><path d="M24 80H216M120 14V146"/><g className="ws-orbit-traveler"><circle cx="120" cy="14" r="5"/></g><circle className="ws-orbit-heart" cx="120" cy="80" r="14"/><circle cx="120" cy="80" r="5"/></svg><span>OBSERVE · CHECK · EXPLAIN</span></div>;
}
