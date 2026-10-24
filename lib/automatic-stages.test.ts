import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticStages,automaticStageIntent,stagesForWallet} from './automatic-stages.ts';

test('all automatic stages are off by default and a lone flag cannot spend',()=>{
  assert.deepEqual(automaticStages({}),{shadow:false,approveByNotification:false,autoBuy:false,maxOrderCents:100,maxDailyCents:200,hardCeilingCents:500,conflicting:false,requireReview:true,notificationWallets:[],autoWallets:[]});
  assert.equal(automaticStages({REQUIRE_INDEPENDENT_REVIEW:'false'}).requireReview,false);
  assert.equal(automaticStages({AUTO_BUY:'true'}).autoBuy,false);
  assert.equal(automaticStages({APPROVE_BY_NOTIFICATION:'true'}).approveByNotification,false);
});
test('stage flags are limited to verified owner wallet addresses',()=>{
  const owner='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
  const stages=automaticStages({SHADOW_MODE:'true',APPROVE_BY_NOTIFICATION:'true',APPROVE_NOTIFICATION_WALLETS:owner,AUTO_BUY_WALLETS:owner});
  assert.equal(stagesForWallet(stages,null).approveByNotification,false);
  assert.equal(stagesForWallet(stages,other).approveByNotification,false);
  assert.equal(stagesForWallet(stages,owner.toUpperCase().replace('0X','0x')).approveByNotification,true);
  assert.equal(stagesForWallet(stages,owner).autoBuy,false);
  assert.throws(()=>automaticStages({APPROVE_NOTIFICATION_WALLETS:'bad'}));
});
test('both stages can be on: armed owners auto-buy, everyone else gets a proposal',()=>{
  assert.equal(automaticStages({SHADOW_MODE:'true'}).shadow,true);
  const both=automaticStages({SHADOW_MODE:'true',APPROVE_BY_NOTIFICATION:'true',AUTO_BUY:'true'});
  assert.equal(both.approveByNotification,true);assert.equal(both.autoBuy,true);
  assert.equal(automaticStageIntent(both,true,true,100,true),'auto');
  assert.equal(automaticStageIntent(both,true,true,100,false),'proposal');
  assert.equal(automaticStageIntent(both,true,true,101,true),'blocked');
  assert.equal(automaticStageIntent(both,true,false,100,true),'none','no sale lot');
  assert.equal(automaticStageIntent(both,true,false,100,true,true),'auto','armed with a sale lot');
  assert.equal(automaticStageIntent(both,true,false,101,true,true),'blocked','sale over the cap');
  assert.equal(automaticStageIntent(both,true,false,100,false,true),'none','sells never become proposals');
});
test('a * allowlist opens a stage to every verified wallet, never to an unverified one',()=>{
  const all=automaticStages({SHADOW_MODE:'true',AUTO_BUY:'true',AUTO_BUY_WALLETS:'*',APPROVE_BY_NOTIFICATION:'true',APPROVE_NOTIFICATION_WALLETS:'*'});
  assert.equal(stagesForWallet(all,'0x'+'c'.repeat(40)).autoBuy,true);
  assert.equal(stagesForWallet(all,'0x'+'c'.repeat(40)).approveByNotification,true);
  assert.equal(stagesForWallet(all,null).autoBuy,false);
  assert.throws(()=>automaticStages({AUTO_BUY_WALLETS:'**'}));
});
test('automatic caps remain tiny and invalid configuration fails closed',()=>{
  assert.deepEqual([automaticStages({AUTO_BUY_MAX_ORDER_CENTS:'50',AUTO_BUY_MAX_DAILY_CENTS:'150'}).maxOrderCents,automaticStages({AUTO_BUY_MAX_ORDER_CENTS:'50',AUTO_BUY_MAX_DAILY_CENTS:'150'}).maxDailyCents],[50,150]);
  assert.throws(()=>automaticStages({AUTO_BUY_MAX_ORDER_CENTS:'501'}));
  assert.throws(()=>automaticStages({AUTO_BUY_MAX_ORDER_CENTS:'101'}));
  assert.throws(()=>automaticStages({AUTO_BUY_MAX_DAILY_CENTS:'251'}));
  assert.throws(()=>automaticStages({AUTO_BUY_MAX_ORDER_CENTS:'200',AUTO_BUY_MAX_DAILY_CENTS:'100'}));
});
test('shadow produces a receipt only; notifications never submit; auto is buy-only and capped',()=>{
  const shadow=automaticStages({SHADOW_MODE:'true'}),proposal=automaticStages({SHADOW_MODE:'true',APPROVE_BY_NOTIFICATION:'true'}),auto=automaticStages({SHADOW_MODE:'true',AUTO_BUY:'true'});
  assert.equal(automaticStageIntent(shadow,true,true,100),'none');
  assert.equal(automaticStageIntent(proposal,true,true,100),'proposal');
  assert.equal(automaticStageIntent(proposal,true,false,100),'none');
  assert.equal(automaticStageIntent(auto,true,true,100),'auto');
  assert.equal(automaticStageIntent(auto,true,true,101),'blocked');
  assert.equal(automaticStageIntent(auto,true,false,100),'none');
  assert.equal(automaticStageIntent(auto,false,true,100),'none');
});
