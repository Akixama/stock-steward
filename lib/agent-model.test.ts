import test from 'node:test';
import assert from 'node:assert/strict';
import {extractModelJson,askAgentModel,AGENT_MODELS} from './strategy-ai-server.ts';
const want={action:'buy',symbol:'NVDA',reason:'Down 3% {today}.'};
test('reads JSON from every Workers AI output shape, including prose and think blocks',()=>{
 assert.deepEqual(extractModelJson({response:want}),want);
 assert.deepEqual(extractModelJson({response:JSON.stringify(want)}),want);
 assert.deepEqual(extractModelJson({choices:[{message:{content:'<think>hmm {x}</think>Here you go:\n```json\n'+JSON.stringify(want)+'\n```'}}]}),want);
 assert.deepEqual(extractModelJson({result:{output:[{content:[{text:'Decision: '+JSON.stringify(want)}]}]}}),want);
 assert.throws(()=>extractModelJson({choices:[{message:{content:'no json here'}}]}));
});
test('tries gpt-oss-120b first and falls back to the original model',async()=>{
 const calls:string[]=[];
 const AI={async run(model:string){calls.push(model);if(model===AGENT_MODELS[0])throw Error('down');return {response:want};}};
 const r=await askAgentModel('s','u',{AI,STEWARD_AI_ENABLED:'true'});
 assert.deepEqual(calls,[...AGENT_MODELS]);assert.equal(r.model,AGENT_MODELS[1]);assert.deepEqual(r.output,want);
 const ok=await askAgentModel('s','u',{AI:{async run(){return {choices:[{message:{content:JSON.stringify(want)}}]};}},STEWARD_AI_ENABLED:'true'});
 assert.equal(ok.model,AGENT_MODELS[0]);
});
