import {interpretationSchema,interpretationJsonSchema,strategyInterpretationPrompt} from './strategy-interpretation.ts';
export const AI_MODEL='@cf/meta/llama-3.1-8b-instruct';
export type AIConfig={CLOUDFLARE_AI_ACCOUNT_ID?:string;CLOUDFLARE_AI_API_TOKEN?:string;STEWARD_AI_ENABLED?:string};
export function aiConfigured(c:AIConfig){return c.STEWARD_AI_ENABLED==='true'&&/^[a-f0-9]{32}$/i.test(c.CLOUDFLARE_AI_ACCOUNT_ID??'')&&!!c.CLOUDFLARE_AI_API_TOKEN;}
export async function readBoundedText(response:Response|Request,limit:number){const reader=response.body?.getReader();if(!reader)return '';let total=0;const parts:Uint8Array[]=[];try{for(;;){const x=await reader.read();if(x.done)break;total+=x.value.byteLength;if(total>limit)throw Error('Request or response too large.');parts.push(x.value);}const data=new Uint8Array(total);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return new TextDecoder().decode(data);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export async function interpretOnServer(direction:string,config:AIConfig,fetcher:typeof fetch=fetch){
 if(!aiConfigured(config))throw Error('AI_UNAVAILABLE');
 const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+config.CLOUDFLARE_AI_ACCOUNT_ID+'/ai/run/'+AI_MODEL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Authorization:'Bearer '+config.CLOUDFLARE_AI_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:strategyInterpretationPrompt},{role:'user',content:direction}],temperature:0,max_tokens:900,response_format:{type:'json_schema',json_schema:interpretationJsonSchema}})});
 if(!response.ok)throw Error(response.status===429?'AI_LIMIT':'AI_UNAVAILABLE');
 const body=JSON.parse(await readBoundedText(response,32000));if(body.success!==true||body.result?.finish_reason&&body.result.finish_reason!=='stop')throw Error('AI_INVALID');
 const raw=body.result?.response;return interpretationSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
}
