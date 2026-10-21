import {claimChainRead} from '@/db/chain-observations';
import {automaticStages} from '@/lib/automatic-stages';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {autonomousPreflight} from '@/lib/autonomous-preflight';
import {chainTransport} from '@/lib/chain-transport';
import type {ReviewAuthorities} from '@/lib/autonomous-release-proof';
const headers={'Cache-Control':'no-store'};
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!automaticStages(env).autoBuy)return Response.json({error:'Automatic rehearsal is off.'},{status:403,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});try{if(!await claimChainRead(env.DB,user.userId))return Response.json({error:"Please wait 15 seconds between chain checks."},{status:429,headers});let authorities:ReviewAuthorities={};try{authorities=JSON.parse(env.STEWARD_AUTONOMY_REVIEW_AUTHORITIES??'{}');}catch{}return Response.json(await autonomousPreflight(env.DB,user.userId,chainTransport(env.ALCHEMY_API_KEY),fetch,authorities),{headers});}catch{return Response.json({error:'The rehearsal could not get complete fresh evidence. No transaction was sent.',executionEnabled:false},{status:503,headers});}}
