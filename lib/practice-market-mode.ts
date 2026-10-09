import type {PracticeSession} from './practice-session.ts';
// Keep balances and historical receipts; old fixture approvals cannot authorize market trades.
export function realPricePractice(session:PracticeSession):PracticeSession{
 if(session.priceSource==='market')return session;
 return {...session,priceSource:'market',running:false,background:false,permissionExpiresAt:null,feedAvailable:false,marketStatus:'waiting',lastMarketQuoteAt:0,lastMarketQuoteAtBySymbol:{},account:{...session.account,grant:false,quoteAt:0},receipts:session.receipts.map(r=>r.outcome==='awaiting_approval'?{...r,outcome:'held',why:'Price source changed to real quotes. Review a fresh market check before approving.'}:r)};
}
