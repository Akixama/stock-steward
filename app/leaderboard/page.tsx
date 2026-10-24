import type {Metadata} from 'next';
import Link from 'next/link';
import {env} from 'cloudflare:workers';
import {ArrowLeft} from 'lucide-react';
import {BrandMark,BrandName} from '@/components/brand';
import {leaderboard,type LeaderboardRow} from '@/db/referrals';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {SIGNUP_POINTS,VERIFIED_POINTS} from '@/lib/referral';
import './leaderboard.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Leaderboard · Stock Steward'};
export default async function LeaderboardPage(){
 let rows:LeaderboardRow[]=[];let failed=false;
 try{const user=await getChatGPTUser().catch(()=>null);if(env.DB)rows=await leaderboard(env.DB,50,user?.userId);else failed=true;}catch{failed=true;}
 return <div className="lb-page"><div className="lb-shell">
  <header className="lb-header"><Link href="/" className="lb-brand"><BrandMark/><BrandName/></Link><Link href="/workspace" className="lb-back"><ArrowLeft size={15}/> Workspace</Link></header>
  <main>
   <span className="lb-kicker">REFERRAL LEADERBOARD</span>
   <h1>Bring people in.<br/><em>Climb the board.</em></h1>
   <p className="lb-lead">{SIGNUP_POINTS} points when a friend signs up with your link. {VERIFIED_POINTS} more when they verify a wallet. Get your link on the Home tab.</p>
   {failed?<p className="lb-empty">The leaderboard is unavailable right now. Try again shortly.</p>:rows.length===0?<p className="lb-empty">No referrals yet. The first invite takes the top spot.</p>:
   <ol className="lb-table">
    <li className="lb-row lb-head"><span>#</span><span>Name</span><span>Signed up</span><span>Verified</span><span>Points</span></li>
    {rows.map(row=><li key={row.rank} className="lb-row" data-top={row.rank<=3} data-you={row.you?'true':undefined}><span className="lb-rank">{row.rank}</span><span className="lb-name">{row.name}{row.you&&<small>you</small>}</span><span>{row.signups}</span><span>{row.verified}</span><span className="lb-points">{row.points.toLocaleString('en-US')}</span></li>)}
   </ol>}
  </main>
 </div></div>;
}
