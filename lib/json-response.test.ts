import assert from 'node:assert/strict';
import test from 'node:test';
import {jsonResponse} from './json-response.ts';

test('HTML Worker errors never expose a JSON parse error in Renew review',async()=>{
  const html=new Response('<!DOCTYPE html><title>Worker error</title>',{status:500,headers:{'content-type':'text/html'}});
  await assert.rejects(jsonResponse(html,'Renew review failed, nothing was sent'),
    {message:'Renew review failed, nothing was sent'});
});

test('malformed JSON also gives the safe Renew message',async()=>{
  const invalid=new Response('<!DOCTYPE html>',{status:502,headers:{'content-type':'application/json'}});
  await assert.rejects(jsonResponse(invalid,'Renew review failed, nothing was sent'),
    {message:'Renew review failed, nothing was sent'});
});

test('valid JSON remains available for server error handling',async()=>{
  const response=Response.json({error:'An earlier wallet request is unresolved.'},{status:409});
  assert.deepEqual(await jsonResponse(response,'Renew review failed, nothing was sent'),
    {error:'An earlier wallet request is unresolved.'});
});
