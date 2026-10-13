import test from 'node:test';import assert from 'node:assert/strict';import {interpretOnServer,aiConfigured,readBoundedText,AI_MODEL} from './strategy-ai-server.ts';
const config={STEWARD_AI_ENABLED:'true',CLOUDFLARE_AI_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_AI_API_TOKEN:'test-placeholder'};
const result={kind:'scheduled',symbol:'AAPL',targets:null,newsKeywords:null,amountUsd:1,reserveUsd:20,intervalHours:24,thresholdUsd:null,sellThresholdUsd:null,targetPercent:null,driftPoints:null,maxMovementPercent:null,mode:'approval',summary:'Buy daily',questions:[],unsupported:[]};
test('provider is opt-in; missing configuration makes no request',async()=>{assert.equal(aiConfigured({...config,STEWARD_AI_ENABLED:'false'}),false);let calls=0;await assert.rejects(()=>interpretOnServer('Buy',{},(async()=>{calls++;return new Response();}) as typeof fetch));assert.equal(calls,0);});
test('server uses fixed model, private auth and bounded JSON schema output',async()=>{const fake=(async(url,init)=>{assert.ok(String(url).endsWith(AI_MODEL));assert.equal(init?.redirect,'manual');const body=JSON.parse(String(init?.body));assert.equal(body.max_tokens,900);assert.equal(body.response_format.type,'json_object');assert.ok(body.messages[0].content.includes('Output JSON schema:'));assert.equal(body.messages[1].content,'Buy daily');assert.equal(JSON.stringify(body).includes('test-placeholder'),false);return Response.json({success:true,result:{response:result}});}) as typeof fetch;assert.deepEqual(await interpretOnServer('Buy daily',config,fake),result);});
test('malformed, oversized and failed provider responses cannot become drafts',async()=>{for(const response of [Response.json({success:false,result:{response:result}}),Response.json({success:true,result:{response:{grant:true}}}),new Response('limited',{status:429}),new Response('x'.repeat(33000))])await assert.rejects(()=>interpretOnServer('Buy',config,(async()=>response) as typeof fetch));await assert.rejects(()=>readBoundedText(new Request('https://example.com',{method:'POST',body:'a'.repeat(101)}),100));});
test('native provider binding drafts without private API credentials or REST calls',async()=>{
 const binding={STEWARD_AI_ENABLED:'true',AI:{async run(model:string,input:unknown){assert.equal(model,AI_MODEL);assert.equal((input as {messages:{content:string}[]}).messages[1].content,'Buy daily');return {response:JSON.stringify(result)};}}};
 assert.equal(aiConfigured(binding),true);
 assert.deepEqual(await interpretOnServer('Buy daily',binding,(async()=>{throw Error('REST must not run');}) as typeof fetch),result);
 assert.equal(aiConfigured({...binding,STEWARD_AI_ENABLED:'false'}),false);
});
test('binding malformed and truncated output remains a failure, never a trade',async()=>{
 for(const response of [{response:{grant:true}},{response:JSON.stringify(result),finish_reason:'length'}])await assert.rejects(()=>interpretOnServer('Buy',{STEWARD_AI_ENABLED:'true',AI:{async run(){return response;}}}));
});
test('provider failures expose only bounded diagnostic categories',async()=>{
 const error=new Error('5025 schema compilation failed: private provider payload');error.name='AiError';
 await assert.rejects(()=>interpretOnServer('Buy',{STEWARD_AI_ENABLED:'true',AI:{async run(){throw error;}}}),{message:'AI_BINDING_5025_FORMAT'});
});
