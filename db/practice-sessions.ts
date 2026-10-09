import {realPricePractice} from '../lib/practice-market-mode.ts';
import {newPracticeSession,transitionPractice,type PracticeAction,type PracticeSession,type PracticeReceipt} from '../lib/practice-session.ts';
import type {Mandate} from '../lib/decision.ts';
import {fetchPracticeMarketQuote,fetchPracticeNews} from '../lib/practice-market.ts';
type Row={owner_ref:string;revision:number;session_json:string};
export async function loadPractice(db:D1Database,owner:string,now=Date.now()){const row=await db.prepare('SELECT revision,session_json FROM practice_sessions WHERE owner_ref=?').bind(owner).first<Row>();return row?{...JSON.parse(row.session_json) as PracticeSession,revision:row.revision}:newPracticeSession(now);}
export async function savePractice(db:D1Database,owner:string,previous:PracticeSession,next:PracticeSession){next.revision=previous.revision+1;const result=await db.prepare(`INSERT INTO practice_sessions(owner_ref,revision,session_json,background,next_due_at) SELECT ?,?,?,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM practice_sessions WHERE owner_ref=? AND revision=?)) AND (SELECT MAX(version) FROM mandates WHERE owner_ref=?)=?
 ON CONFLICT(owner_ref) DO UPDATE SET revision=excluded.revision,session_json=excluded.session_json,background=excluded.background,next_due_at=excluded.next_due_at WHERE practice_sessions.revision=?`)
 .bind(owner,next.revision,JSON.stringify(next),next.background&&next.running&&next.account.grant?1:0,next.nextDueAt,previous.revision,owner,previous.revision,owner,next.mandateVersion,previous.revision).run();return result.meta.changes===1;}
export async function commandPractice(db:D1Database,owner:string,expected:number,action:PracticeAction,m:Mandate,now=Date.now(),trigger:PracticeReceipt['trigger']='manual'){
 const previous=await loadPractice(db,owner,now);if(previous.revision!==expected)throw Error('PRACTICE_CONFLICT');let beforeAction=previous;
 if(action.action==='run')beforeAction=await preparePracticeRun(previous,m,now,trigger);
 const next=transitionPractice(beforeAction,m,action,now,trigger);if(!await savePractice(db,owner,previous,next))throw Error('PRACTICE_CONFLICT');return next;
}
async function preparePracticeRun(session:PracticeSession,m:Mandate,now:number,trigger:PracticeReceipt['trigger']){
 if(session.priceSource!=='market'||!session.strategy||session.receipts.some(r=>r.outcome==='awaiting_approval')||now-session.lastCheckWallAt<8000)return session;
 const symbols=[...new Set([...(session.strategy.kind==='portfolio'?session.strategy.targets!.map(t=>t.symbol):[session.strategy.symbol]),...Object.entries(session.account.holdingsCents).filter(([,value])=>value>0).map(([held])=>held)])];
 const quotes=await Promise.all(symbols.map(symbol=>fetchPracticeMarketQuote(symbol,now)));
 let next=transitionPractice(session,m,symbols.length===1?{action:'market_quote',quote:quotes[0]}:{action:'market_quotes',quotes},now,trigger);
 if(next.strategy&&(next.strategy.kind==='news_buy'||next.strategy.kind==='news_sell')){
  const news=await fetchPracticeNews(next.strategy.symbol,now);
  next=transitionPractice(next,m,{action:'news_items',items:news},now,trigger);
 }
 return next;
}
export async function tickPracticeSessions(db:D1Database,now=Date.now(),realQuotesOnly=false){
 const rows=await db.prepare('SELECT owner_ref,revision,session_json FROM practice_sessions WHERE background=1 AND next_due_at<=? ORDER BY next_due_at LIMIT 5').bind(now).all<Row>();const summary={checked:0,updated:0,conflicts:0,failed:0,transactionsSent:0};
 for(const row of rows.results){summary.checked++;try{const stored=await db.prepare('SELECT policy_json FROM mandates WHERE owner_ref=? ORDER BY version DESC LIMIT 1').bind(row.owner_ref).first<{policy_json:string}>();const mandate=stored?JSON.parse(stored.policy_json) as Mandate:null;if(!mandate)throw Error('Saved boundaries unavailable.');const before={...JSON.parse(row.session_json) as PracticeSession,revision:row.revision};let next=transitionPractice(realQuotesOnly?realPricePractice(before):before,mandate,{action:'refresh'},now,'background');if(next.running&&next.background&&next.account.grant){next=await preparePracticeRun(next,mandate,now,'background');next=transitionPractice(next,mandate,{action:'run'},now,'background');}next.nextDueAt=now+900000;if(await savePractice(db,row.owner_ref,before,next))summary.updated++;else summary.conflicts++;}catch{summary.failed++;await db.prepare('UPDATE practice_sessions SET next_due_at=? WHERE owner_ref=? AND revision=?').bind(now+900000,row.owner_ref,row.revision).run();}}
 return summary;
}
