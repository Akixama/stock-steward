import test from 'node:test';import assert from 'node:assert/strict';import {issueDemoSession,reissueDemoSession,verifyDemoSession,demoSessionCookie,demoSessionClearedCookie,DEMO_COOKIE_NAME} from './demo-auth.ts';
const secret='demo-secret-0123456789abcdef',now=Date.parse('2026-10-06T12:00:00Z');

test('a demo session issues and verifies a scoped identity',async()=>{
 const issued=await issueDemoSession(secret,'Ada',now);
 assert.ok(issued);assert.match(issued.identity.userId,/^[0-9a-f-]{36}$/);
 assert.equal(issued.identity.displayName,'Ada');
 const verified=await verifyDemoSession(secret,issued.cookieValue,now+1000);
 assert.deepEqual(verified,{userId:issued.identity.userId,displayName:'Ada',expiresAt:issued.identity.expiresAt});
 assert.match(demoSessionCookie(issued.cookieValue),new RegExp(`^${DEMO_COOKIE_NAME}=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=/`));
 assert.match(demoSessionClearedCookie(),/Max-Age=0$/);
});
test('tampered, forged, malformed or expired sessions are refused',async()=>{
 const issued=await issueDemoSession(secret,'Ada',now);
 const cookie=issued!.cookieValue;
 for(const bad of [
  cookie.replace('Ada','Eve'),
  cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a'),
  cookie.replace(/^1\|/,'2|'),
  cookie.replace(/\|\d{13}\|/,'|9999999999999|'),
  `1|${'0'.repeat(36)}|Ada|${now+1000}|${'a'.repeat(64)}`,
  '', 'x', '1|a|b|c', null, undefined, 123,
 ]) assert.equal(await verifyDemoSession(secret,bad,now+1000),null,String(bad).slice(0,40));
 assert.equal(await verifyDemoSession('other-secret-0123456789abcdef',cookie,now+1000),null);
 assert.equal(await verifyDemoSession(secret,cookie,now+31*86400000),null);
});
test('weak secrets refuse to issue and invalid display names fall back',async()=>{
 assert.equal(await issueDemoSession('short','Ada',now),null);
 const issued=await issueDemoSession(secret,'<script>alert(1)</script>',now);
 assert.equal(issued!.identity.displayName,'Practice Demo');
});

test('reissue keeps the same workspace identity with a fresh expiry', async () => {
 const secret='demo-auth-test-secret-value';
 const first=await issueDemoSession(secret,'Ada',1000);
 assert.ok(first);
 const again=await reissueDemoSession(secret,first!.identity,5000,10_000);
 assert.ok(again);
 assert.equal(again!.identity.userId,first!.identity.userId);
 assert.equal(again!.identity.displayName,'Ada');
 const verified=await verifyDemoSession(secret,again!.cookieValue,5000);
 assert.equal(verified?.userId,first!.identity.userId);
 assert.equal(verified?.expiresAt,15_000);
});

test('session cookie spans the production domain family only', () => {
 const shared=demoSessionCookie('v|x|n|1|s',30,'stocksteward.app');
 assert.ok(shared.includes('; Domain=.stocksteward.app'));
 assert.ok(demoSessionCookie('v|x|n|1|s',30,'www.stocksteward.app').includes('; Domain=.stocksteward.app'));
 assert.ok(!demoSessionCookie('v|x|n|1|s',30,'example.com').includes('Domain='));
 assert.ok(demoSessionClearedCookie('stocksteward.app').includes('; Domain=.stocksteward.app'));
 assert.ok(!demoSessionClearedCookie('').includes('Domain='));
});
