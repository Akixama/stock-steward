import {env} from 'cloudflare:workers';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import type {Mandate} from '@/lib/decision';
import WorkspaceClient from './workspace-client';
import {cookies} from 'next/headers';
import {claimReferral} from '@/db/referrals';
import {REFERRAL_COOKIE} from '@/lib/referral';
export const dynamic='force-dynamic';
export default async function WorkspacePage({searchParams}:{searchParams?:Promise<{view?:string|string[];symbol?:string|string[]}>}){
  const params=await searchParams;
  const requestedSymbol=typeof params?.symbol==='string'?params.symbol.toUpperCase():'';
  const returnTo=params?.view==='alerts'&&/^[A-Z][A-Z0-9.]{0,7}$/.test(requestedSymbol)
    ?`/workspace?view=alerts&symbol=${encodeURIComponent(requestedSymbol)}`
    :params?.view==='alerts'?'/workspace?view=alerts':'/workspace';
  const user=await requireChatGPTUser(returnTo);
  let mandate:Mandate|null=null;
  let storageError:string|null=null;
  try{
    if(!env.DB)throw Error('Database unavailable');
    // Credit an invite once, on a brand-new workspace. A failure never blocks the page.
    const invite=(await cookies()).get(REFERRAL_COOKIE)?.value;
    if(invite)await claimReferral(env.DB,user.userId,invite).catch(()=>false);
    mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
  }catch(error){
    console.error('Workspace storage unavailable',error);
    storageError='Your saved workspace is temporarily unavailable. Please try again shortly.';
  }
  return <WorkspaceClient initialMandate={mandate} storageError={storageError} publicMode={env.PUBLIC_MODE==='true'} codeReminder={user.email.endsWith('@demo.local')}/>;
}
