import {evaluatePriceAlert,validateAlertInput,type PriceAlert,type PriceAlertInput} from '../lib/price-alerts.ts';
import {fetchPracticeMarketQuote} from '../lib/practice-market.ts';
type Row={id:string;symbol:string;direction:'above'|'below';price_cents:number;created_at:string;status:'active'|'triggered';triggered_at:string|null;observed_price_cents:number|null};
const MAX_ALERTS=20;
function hydrate(row:Row):PriceAlert{return {id:row.id,symbol:row.symbol,direction:row.direction,priceCents:row.price_cents,createdAt:row.created_at,status:row.status,triggeredAt:row.triggered_at,observedPriceCents:row.observed_price_cents};}
export async function listAlerts(db:D1Database,owner:string):Promise<PriceAlert[]>{
 const rows=await db.prepare('SELECT id,symbol,direction,price_cents,created_at,status,triggered_at,observed_price_cents FROM price_alerts WHERE owner_ref=? ORDER BY created_at DESC LIMIT ?').bind(owner,MAX_ALERTS).all<Row>();
 return (rows.results??[]).map(hydrate);
}
export async function createAlert(db:D1Database,owner:string,value:unknown,now=Date.now()):Promise<PriceAlert>{
 const input=validateAlertInput(value);
 const existing=await db.prepare('SELECT COUNT(*) AS n FROM price_alerts WHERE owner_ref=?').bind(owner).first<{n:number}>();
 if((existing?.n??0)>=MAX_ALERTS)throw Error(`You can arm up to ${MAX_ALERTS} alerts. Remove one before adding another.`);
 const alert:PriceAlert={id:crypto.randomUUID(),symbol:input.symbol,direction:input.direction,priceCents:input.priceCents,createdAt:new Date(now).toISOString(),status:'active',triggeredAt:null,observedPriceCents:null};
 await db.prepare('INSERT INTO price_alerts(id,owner_ref,symbol,direction,price_cents,created_at,status,triggered_at,observed_price_cents) VALUES(?,?,?,?,?,?,?,?,?)').bind(alert.id,owner,alert.symbol,alert.direction,alert.priceCents,alert.createdAt,alert.status,null,null).run();
 return alert;
}
export async function removeAlert(db:D1Database,owner:string,id:string):Promise<boolean>{
 if(typeof id!=='string'||!id)return false;
 const result=await db.prepare('DELETE FROM price_alerts WHERE owner_ref=? AND id=?').bind(owner,id).run();
 return result.meta.changes===1;
}
export async function checkAlerts(db:D1Database,owner:string,now=Date.now()):Promise<{alerts:PriceAlert[];triggered:PriceAlert[];checked:number}>{
 const alerts=await listAlerts(db,owner);
 const armed=alerts.filter(alert=>alert.status==='active');
 const symbols=[...new Set(armed.map(alert=>alert.symbol))];
 const quotes=await Promise.all(symbols.map(symbol=>fetchPracticeMarketQuote(symbol,now)));
 const bySymbol=new Map(symbols.map((symbol,index)=>[symbol,quotes[index]]));
 const triggered:PriceAlert[]=[];
 for(const alert of armed){
  const outcome=evaluatePriceAlert(alert,bySymbol.get(alert.symbol)??null,now);
  if(!outcome.triggered)continue;
  await db.prepare('UPDATE price_alerts SET status=?,triggered_at=?,observed_price_cents=? WHERE owner_ref=? AND id=? AND status=?').bind(outcome.alert.status,outcome.alert.triggeredAt,outcome.alert.observedPriceCents,owner,alert.id,'active').run();
  triggered.push(outcome.alert);
 }
 return {alerts:await listAlerts(db,owner),triggered,checked:armed.length};
}
