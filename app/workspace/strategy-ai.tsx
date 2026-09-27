'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles,ArrowRight,Check} from 'lucide-react';
import type {MLCEngineInterface} from '@mlc-ai/web-llm';
import {interpretationJsonSchema,strategyInterpretationPrompt,reviewInterpretation} from '@/lib/strategy-interpretation';
import type {Strategy} from '@/lib/strategy';
type Review=ReturnType<typeof reviewInterpretation>;
export default function StrategyAI({direction,base,onDraft}:{direction:string;base:Strategy;onDraft:(draft:Strategy)=>void}){
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null);const engine=useRef<MLCEngineInterface|null>(null),worker=useRef<Worker|null>(null),generation=useRef(0),alive=useRef(true),source=useRef(direction);source.current=direction;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;engine.current?.interruptGenerate();worker.current?.terminate();};},[]);
 useEffect(()=>{generation.current++;setReview(null);engine.current?.interruptGenerate();if(engine.current)setBusy(false);},[direction,base]);
 async function load(){if(busy)return;setBusy(true);setError('');try{
  if(!('gpu' in navigator))throw Error('This browser does not support WebGPU. Use a compatible desktop browser or enter the rules manually.');
  const {CreateWebWorkerMLCEngine}=await import('@mlc-ai/web-llm');
  const w=new Worker(new URL('../../lib/strategy-ai.worker.ts',import.meta.url),{type:'module'});worker.current=w;
  const result=await CreateWebWorkerMLCEngine(w,'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',{initProgressCallback:p=>{if(alive.current)setProgress(`${Math.round(p.progress*100)}% · ${p.text}`);}});
  if(!alive.current){w.terminate();return;}engine.current=result;setReady(true);setProgress('Local AI ready. Review every proposed rule.');
 }catch(e){worker.current?.terminate();worker.current=null;setError(e instanceof Error&&e.message.startsWith('This browser')?e.message:'Local model could not load. Downloads, GPU support or memory may be unavailable. You can still set rules manually.');}finally{if(alive.current)setBusy(false);}}
 async function interpret(){const current=engine.current;if(!current||!direction.trim()||busy)return;const ticket=++generation.current,input=direction;setBusy(true);setError('');setReview(null);try{
  const response=await current.chat.completions.create({messages:[{role:'system',content:strategyInterpretationPrompt},{role:'user',content:input}],temperature:0,max_tokens:900,response_format:{type:'json_object',schema:JSON.stringify(interpretationJsonSchema)}});
  if(ticket!==generation.current||source.current!==input||!alive.current)return;
  const content=response.choices[0]?.message.content;if(!content||response.choices[0]?.finish_reason!=='stop')throw Error();
  setReview(reviewInterpretation(JSON.parse(content),input,base));
 }catch{if(ticket===generation.current&&alive.current)setError('The model could not produce complete valid rules. Clarify your amounts and conditions, or use the fields below. Nothing was activated.');}finally{if(ticket===generation.current&&alive.current)setBusy(false);}}
 return <section className="ws-ai"><div className="ws-ai-heading"><Sparkles size={19}/><strong>Turn your direction into a draft</strong><span>LOCAL AI · OPTIONAL</span></div><p>A small model runs in your browser, with no paid API account. First load downloads several hundred MB and needs a compatible GPU; it may take a few minutes. Your direction stays on this device. Local models can misunderstand instructions.</p><div className="ws-action-row">{!ready?<button className="ws-action-primary" disabled={busy} onClick={load}>{busy?'Loading local model…':'Download & enable local AI'}</button>:<button className="ws-action-primary" disabled={busy||!direction.trim()} onClick={interpret}><Sparkles size={16}/>{busy?'Interpreting your direction…':'Interpret my direction'}</button>}</div>{progress&&<small className="ws-ai-progress" role="status">{progress}</small>}{error&&<p className="ws-error" role="alert">{error}</p>}
 {review&&<div className="ws-ai-review"><strong>{review.draft?'AI draft ready for your review':'A little more direction needed'}</strong><p>{review.result.summary}</p>{review.questions.map(q=><p key={q}>→ {q}</p>)}{review.unsupported.map(q=><p key={q}>Unsupported: {q}</p>)}{review.draft&&<><p>{review.draft.kind} · {review.draft.symbol} · ${(review.draft.amountCents/100).toFixed(2)} per purchase · ${(review.draft.reserveCents/100).toFixed(2)} cash reserve · {review.draft.mode}.</p><button className="ws-action-primary" onClick={()=>{onDraft(review.draft!);setReview(null);}}><Check size={16}/>Use these draft rules <ArrowRight size={16}/></button></>}<small>No activation, permission or purchase occurs here. Compare the fields with your direction, then review and confirm separately.</small></div>}
 </section>;
}
