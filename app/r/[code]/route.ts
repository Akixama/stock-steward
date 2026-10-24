import {isReferralCode,REFERRAL_COOKIE} from '@/lib/referral';
// Invite links look like stocksteward.app/r/ABC234. The code is kept for 30 days
// and credited the first time the visitor opens a brand-new workspace.
export async function GET(request:Request,{params}:{params:Promise<{code:string}>}){
 const {code}=await params;const value=code.toUpperCase();
 const headers=new Headers({location:new URL('/',request.url).toString(),'cache-control':'no-store'});
 if(isReferralCode(value))headers.append('set-cookie',`${REFERRAL_COOKIE}=${value}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`);
 return new Response(null,{status:303,headers});
}
