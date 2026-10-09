import test from 'node:test';import assert from 'node:assert/strict';
import {evaluatePriceAlert,validateAlertInput,type PriceAlert} from './price-alerts.ts';
const now=Date.UTC(2026,9,6,12);
const alert:PriceAlert={id:'a1',symbol:'AAPL',direction:'above',priceCents:18000,createdAt:new Date(now).toISOString(),status:'active',triggeredAt:null,observedPriceCents:null};
test('alert input validation rejects malformed alerts',()=>{
 assert.deepEqual(validateAlertInput({symbol:'AAPL',direction:'below',priceCents:17500}),{symbol:'AAPL',direction:'below',priceCents:17500});
 assert.throws(()=>validateAlertInput({symbol:'aapl',direction:'above',priceCents:100}),/valid stock symbol/);
 assert.throws(()=>validateAlertInput({symbol:'AAPL',direction:'sideways',priceCents:100}),/above or below/);
 assert.throws(()=>validateAlertInput({symbol:'AAPL',direction:'above',priceCents:0}),/positive alert price/);
});
test('crossing alerts trigger with observed price and never re-trigger',()=>{
 const quote={priceCents:18100,bidCents:18050,generatedAt:now-5000};
 const up=evaluatePriceAlert(alert,quote,now);
 assert.equal(up.triggered,true);assert.equal(up.alert.status,'triggered');assert.equal(up.alert.observedPriceCents,18050);
 assert.ok(up.alert.triggeredAt);
 const again=evaluatePriceAlert(up.alert,quote,now+1000);
 assert.equal(again.triggered,false);assert.equal(again.alert.status,'triggered');
 const below=evaluatePriceAlert({...alert,direction:'below',priceCents:18000},{priceCents:17900,bidCents:17850,generatedAt:now-5000},now);
 assert.equal(below.triggered,true);assert.equal(below.alert.observedPriceCents,17850);
 assert.equal(evaluatePriceAlert(alert,{priceCents:17900,bidCents:17850,generatedAt:now-5000},now).triggered,false);
 assert.equal(evaluatePriceAlert(alert,{priceCents:18100,generatedAt:now-5000},now).alert.observedPriceCents===18100,true);
});
test('stale or missing quotes leave the alert armed',()=>{
 assert.equal(evaluatePriceAlert(alert,{priceCents:19000,generatedAt:now-120000},now).triggered,false);
 assert.equal(evaluatePriceAlert(alert,null,now).triggered,false);
 assert.equal(evaluatePriceAlert(alert,{priceCents:19000,generatedAt:now+600000},now).triggered,false);
 const armed=evaluatePriceAlert(alert,{priceCents:17000,generatedAt:now-5000},now);
 assert.equal(armed.alert.status,'active');assert.equal(armed.alert.triggeredAt,null);
});
