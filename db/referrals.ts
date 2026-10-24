import {isReferralCode,newReferralCode,publicName,referralPoints,validDisplayName} from '../lib/referral.ts';

export type ReferralSummary={code:string;displayName:string|null;signups:number;verified:number;points:number;rank:number|null};
export type LeaderboardRow={rank:number;name:string;signups:number;verified:number;points:number;you?:boolean};

export async function ensureReferralCode(db:D1Database,owner:string,now=new Date(),random?:(n:number)=>Uint8Array):Promise<string>{
 const existing=await db.prepare('SELECT code FROM referral_codes WHERE owner_ref=?').bind(owner).first<{code:string}>();
 if(existing)return existing.code;
 for(let attempt=0;attempt<8;attempt++){
  const code=newReferralCode(random);
  const result=await db.prepare('INSERT INTO referral_codes(owner_ref,code,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(owner,code,now.toISOString()).run();
  if(result.meta.changes===1)return code;
  const mine=await db.prepare('SELECT code FROM referral_codes WHERE owner_ref=?').bind(owner).first<{code:string}>();
  if(mine)return mine.code;
 }
 throw Error('REFERRAL_CODE_UNAVAILABLE');
}

// The first valid code wins. You cannot refer yourself, and an account that
// already has a referrer keeps it.
export async function claimReferral(db:D1Database,referred:string,code:unknown,now=new Date()):Promise<boolean>{
 if(!isReferralCode(code))return false;
 const owner=await db.prepare('SELECT owner_ref FROM referral_codes WHERE code=?').bind(code).first<{owner_ref:string}>();
 if(!owner||owner.owner_ref===referred)return false;
 // An account that already had limits, a wallet or its own invite code before
 // following a link is not a new referral.
 const established=await db.prepare(`SELECT 1 AS found WHERE EXISTS(SELECT 1 FROM referral_codes WHERE owner_ref=?1)
  OR EXISTS(SELECT 1 FROM mandates WHERE owner_ref=?1) OR EXISTS(SELECT 1 FROM wallet_ownership WHERE owner_ref=?1)`).bind(referred).first<{found:number}>();
 if(established)return false;
 const result=await db.prepare('INSERT INTO referrals(referred_ref,referrer_ref,code,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(referred,owner.owner_ref,code,now.toISOString()).run();
 return result.meta.changes===1;
}

const COUNTS=`SELECT c.owner_ref AS owner_ref,c.code AS code,c.display_name AS display_name,
 COUNT(r.referred_ref) AS signups,
 SUM(CASE WHEN w.verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified
 FROM referral_codes c JOIN referrals r ON r.referrer_ref=c.owner_ref
 LEFT JOIN wallet_ownership w ON w.owner_ref=r.referred_ref
 GROUP BY c.owner_ref,c.code,c.display_name`;

type CountRow={owner_ref:string;code:string;display_name:string|null;signups:number;verified:number|null};
function ranked(rows:CountRow[]){
 return rows.map(row=>({...row,verified:Number(row.verified??0),signups:Number(row.signups),points:referralPoints(Number(row.signups),Number(row.verified??0))}))
  .sort((a,b)=>b.points-a.points||b.verified-a.verified||a.code.localeCompare(b.code));
}

export async function referralSummary(db:D1Database,owner:string,now=new Date()):Promise<ReferralSummary>{
 const code=await ensureReferralCode(db,owner,now);
 const name=await db.prepare('SELECT display_name FROM referral_codes WHERE owner_ref=?').bind(owner).first<{display_name:string|null}>();
 const all=ranked((await db.prepare(COUNTS).bind().all<CountRow>()).results??[]);
 const index=all.findIndex(row=>row.owner_ref===owner);
 const mine=index>=0?all[index]:null;
 return {code,displayName:name?.display_name??null,signups:mine?.signups??0,verified:mine?.verified??0,points:mine?.points??0,rank:index>=0?index+1:null};
}

export async function leaderboard(db:D1Database,limit=25,viewer?:string):Promise<LeaderboardRow[]>{
 const all=ranked((await db.prepare(COUNTS).bind().all<CountRow>()).results??[]);
 return all.slice(0,Math.max(1,Math.min(limit,100))).map((row,i)=>({rank:i+1,name:publicName(row.display_name,row.code),signups:row.signups,verified:row.verified,points:row.points,...(viewer&&row.owner_ref===viewer?{you:true}:{})}));
}

export async function setReferralName(db:D1Database,owner:string,value:unknown,now=new Date()):Promise<string|null>{
 const name=validDisplayName(value);
 await ensureReferralCode(db,owner,now);
 if(name){
  const taken=await db.prepare('SELECT 1 AS found FROM referral_codes WHERE lower(display_name)=lower(?) AND owner_ref<>?').bind(name,owner).first<{found:number}>();
  if(taken)throw Error('NAME_TAKEN');
 }
 await db.prepare('UPDATE referral_codes SET display_name=? WHERE owner_ref=?').bind(name,owner).run();
 return name;
}
