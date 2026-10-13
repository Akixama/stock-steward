import {interpretationSchema,interpretationJsonSchema,strategyInterpretationPrompt} from './strategy-interpretation.ts';
export const AI_MODEL='@cf/meta/llama-3.1-8b-instruct-fp8';
const extractionPrompt=strategyInterpretationPrompt+'\nOutput JSON schema:\n'+JSON.stringify(interpretationJsonSchema);
export type AIBinding={run(model:string,input:unknown):Promise<unknown>};
export type AIConfig={AI?:AIBinding;CLOUDFLARE_AI_ACCOUNT_ID?:string;CLOUDFLARE_AI_API_TOKEN?:string;STEWARD_AI_ENABLED?:string};
export function aiConfigured(c:AIConfig){return c.STEWARD_AI_ENABLED==='true'&&(typeof c.AI?.run==='function'||(/^[a-f0-9]{32}$/i.test(c.CLOUDFLARE_AI_ACCOUNT_ID??'')&&!!c.CLOUDFLARE_AI_API_TOKEN));}
export async function readBoundedText(response:Response|Request,limit:number){const reader=response.body?.getReader();if(!reader)return '';let total=0;const parts:Uint8Array[]=[];try{for(;;){const x=await reader.read();if(x.done)break;total+=x.value.byteLength;if(total>limit)throw Error('Request or response too large.');parts.push(x.value);}const data=new Uint8Array(total);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return new TextDecoder().decode(data);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export async function interpretOnServer(direction:string,config:AIConfig,fetcher:typeof fetch=(...args)=>fetch(...args)){
 if(!aiConfigured(config))throw Error('AI_UNAVAILABLE');
 if(config.AI){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([config.AI.run(AI_MODEL,{messages:[{role:'system',content:extractionPrompt},{role:'user',content:direction}],temperature:0,max_tokens:900,response_format:{type:'json_object'}}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('AI_TIMEOUT')),25000);})]);
   const serialized=JSON.stringify(result);if(!serialized||serialized.length>32000)throw Error('AI_INVALID');
   const body=JSON.parse(serialized);if(body.finish_reason&&body.finish_reason!=='stop')throw Error('AI_INVALID');
   const raw=typeof body.response==='string'?JSON.parse(body.response):body.response;
   return interpretationSchema.parse(raw);
  }catch(error){
   // Record only provider codes/categories; never log a prompt or provider payload.
   if(error instanceof Error&&error.name==='AiError'){
    const code=error.message.match(/\b\d{4,5}\b/)?.[0]??'UNKNOWN';
    const category=/schema|grammar|format/i.test(error.message)?'FORMAT':/quota|limit|neuron/i.test(error.message)?'LIMIT':/model|not found/i.test(error.message)?'MODEL':/permission|authoriz|account/i.test(error.message)?'ACCESS':'PROVIDER';
    throw Error(`AI_BINDING_${code}_${category}`);
   }
   throw error;
  }finally{if(timer)clearTimeout(timer);}
 }
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);let response:Response;try{response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+config.CLOUDFLARE_AI_ACCOUNT_ID+'/ai/run/'+AI_MODEL,{method:'POST',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+config.CLOUDFLARE_AI_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:extractionPrompt},{role:'user',content:direction}],temperature:0,max_tokens:900,response_format:{type:'json_object'}})});}catch(e){const message=e instanceof Error?e.message:'';const category=/redirect/i.test(message)?'REDIRECT':/header|ByteString|character/i.test(message)?'HEADER':/signal|abort/i.test(message)?'SIGNAL':/Illegal invocation/i.test(message)?'INVOCATION':/outbound|disallow|host|blocked/i.test(message)?'EGRESS':/network|connection|fetch failed/i.test(message)?'NETWORK':'UNKNOWN';throw Error('AI_FETCH_'+category);}finally{clearTimeout(timeout);}
 if(!response.ok)throw Error(response.status===429?'AI_LIMIT':'AI_UNAVAILABLE');
 const body=JSON.parse(await readBoundedText(response,32000));if(body.success!==true||body.result?.finish_reason&&body.result.finish_reason!=='stop')throw Error('AI_INVALID');
 const raw=body.result?.response;let decoded;try{decoded=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('AI_JSON');}const parsed=interpretationSchema.safeParse(decoded);if(!parsed.success)throw Error('AI_SCHEMA_'+parsed.error.issues.map(i=>i.path.join('_')||'ROOT').join('_').toUpperCase().replace(/[^A-Z_0-9]/g,'_'));return parsed.data;
}
