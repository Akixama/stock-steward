import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {claimReferral,ensureReferralCode,leaderboard,referralSummary,setReferralName} from './referrals.ts';
import {isReferralCode,newReferralCode,publicName,referralPoints,validDisplayName} from '../lib/referral.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync('drizzle/0040_referrals.sql','utf8'));
 sql.exec('CREATE TABLE mandates(owner_ref TEXT NOT NULL,version INTEGER NOT NULL,policy_json TEXT NOT NULL,created_at TEXT NOT NULL)');
 sql.exec('CREATE TABLE wallet_ownership(owner_ref TEXT PRIMARY KEY,address TEXT NOT NULL,verified_at TEXT)');
 const db={prepare(q:string){let args:(string|number|null)[]=[];const stmt={bind(...values:typeof args){args=values;return stmt;},async first(){return sql.prepare(q).get(...args)??null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}};return stmt;}} as unknown as D1Database;
 return {sql,db};
}

test('referral codes are short, unambiguous and stable per account',async()=>{
 const {db}=database();
 const code=await ensureReferralCode(db,'alice');
 assert.ok(isReferralCode(code));
 assert.equal(await ensureReferralCode(db,'alice'),code);
 assert.ok(!/[01IOL]/.test(newReferralCode()));
 assert.equal(isReferralCode('abc123'),false);
});

test('a new account is credited to the first valid code only, never to itself',async()=>{
 const {db,sql}=database();
 const alice=await ensureReferralCode(db,'alice');
 const bob=await ensureReferralCode(db,'bob');
 assert.equal(await claimReferral(db,'alice',alice),false,'self referral');
 assert.equal(await claimReferral(db,'carol','ZZZZZZ'),false,'unknown code');
 assert.equal(await claimReferral(db,'carol',alice),true);
 assert.equal(await claimReferral(db,'carol',bob),false,'second claim');
 sql.exec("INSERT INTO mandates VALUES('dave',1,'{}','2026-01-01T00:00:00Z')");
 assert.equal(await claimReferral(db,'dave',alice),false,'existing account');
 sql.exec("INSERT INTO wallet_ownership VALUES('erin','0xabc',NULL)");
 assert.equal(await claimReferral(db,'erin',alice),false,'existing wallet');
});

test('points count signups and verified wallets, and the board ranks by points',async()=>{
 const {db,sql}=database();
 const alice=await ensureReferralCode(db,'alice');
 const bob=await ensureReferralCode(db,'bob');
 for(const friend of ['f1','f2','f3'])assert.equal(await claimReferral(db,friend,alice),true);
 for(const friend of ['g1','g2'])assert.equal(await claimReferral(db,friend,bob),true);
 sql.exec("INSERT INTO wallet_ownership VALUES('g1','0x1','2026-01-02T00:00:00Z'),('g2','0x2','2026-01-02T00:00:00Z'),('f1','0x3',NULL)");
 const a=await referralSummary(db,'alice'),b=await referralSummary(db,'bob');
 assert.deepEqual([a.signups,a.verified,a.points],[3,0,30]);
 assert.deepEqual([b.signups,b.verified,b.points,b.rank],[2,2,200,1]);
 assert.equal(a.rank,2);
 const none=await referralSummary(db,'nobody');
 assert.equal(none.points,0);assert.equal(none.rank,null);
 const board=await leaderboard(db,10,'bob');
 assert.deepEqual(board.map(r=>r.points),[200,30]);
 assert.equal(board[0].you,true);
 assert.equal(board[1].name,`Steward ${alice.slice(0,4)}`);
 assert.equal(referralPoints(1,1),100);
});

test('public names are validated, unique and never fall back to private data',async()=>{
 const {db}=database();
 await ensureReferralCode(db,'alice');
 assert.equal(await setReferralName(db,'alice','  Aki  the dev '),'Aki the dev');
 await assert.rejects(setReferralName(db,'bob','aki THE dev'),/NAME_TAKEN/);
 await assert.rejects(setReferralName(db,'bob','<script>'),/INVALID_NAME/);
 assert.equal(await setReferralName(db,'alice',''),null);
 assert.throws(()=>validDisplayName('x'));
 assert.equal(publicName(null,'ABCDEF'),'Steward ABCD');
});
