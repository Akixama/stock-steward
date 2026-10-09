export type PriceAlert={id:string;symbol:string;direction:'above'|'below';priceCents:number;createdAt:string;status:'active'|'triggered';triggeredAt:string|null;observedPriceCents:number|null};
export type PriceAlertInput={symbol:string;direction:'above'|'below';priceCents:number};
export function validateAlertInput(value:unknown):PriceAlertInput{
 const v=value as PriceAlertInput;
 if(!v||typeof v!=='object')throw Error('Enter an alert.');
 if(typeof v.symbol!=='string'||!/^[A-Z][A-Z0-9.]{0,7}$/.test(v.symbol))throw Error('Choose a valid stock symbol.');
 if(v.direction!=='above'&&v.direction!=='below')throw Error('Choose above or below.');
 if(!Number.isSafeInteger(v.priceCents)||v.priceCents<1||v.priceCents>100000000)throw Error('Use a positive alert price.');
 return {symbol:v.symbol,direction:v.direction,priceCents:v.priceCents};
}
// Alerts compare against the read-only indicative bid, the same quote used to value holdings.
export function evaluatePriceAlert(alert:PriceAlert,quote:{priceCents:number;bidCents?:number;generatedAt:number}|null,now:Date|string|number):{alert:PriceAlert;triggered:boolean;reason:string}{
 const at=typeof now==='string'?Date.parse(now):now instanceof Date?now.getTime():now;
 if(alert.status==='triggered')return {alert,triggered:false,reason:'Already triggered.'};
 if(!quote||!Number.isSafeInteger(quote.generatedAt)||at-quote.generatedAt>60000||quote.generatedAt>at+10000)return {alert,triggered:false,reason:'No fresh quote; the alert stays armed.'};
 const observed=quote.bidCents??quote.priceCents;
 if(!Number.isSafeInteger(observed)||observed<1)return {alert,triggered:false,reason:'No usable quote; the alert stays armed.'};
 const crossed=alert.direction==='above'?observed>=alert.priceCents:observed<=alert.priceCents;
 if(!crossed)return {alert,triggered:false,reason:`Price $${(observed/100).toFixed(2)} has not crossed $${(alert.priceCents/100).toFixed(2)}.`};
 const atIso=new Date(at).toISOString();
 return {alert:{...alert,status:'triggered',triggeredAt:atIso,observedPriceCents:observed},triggered:true,reason:`Observed $${(observed/100).toFixed(2)} ${alert.direction==='above'?'at or above':'at or below'} $${(alert.priceCents/100).toFixed(2)}.`};
}
