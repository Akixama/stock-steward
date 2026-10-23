import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { backfillInbox, createTestInbox, inbox, markInboxRead } from '@/db/notification-inbox';
import { sendInboxPush } from '@/lib/inbox-push';
import {claimProposalReview} from '@/db/automatic-stage-events';
import {getOwnership} from '@/db/wallet-ownership';
import {automaticStages,stagesForWallet} from '@/lib/automatic-stages';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  if (!env.DB) return Response.json({ error: 'Alerts are unavailable.' }, { status: 503, headers });
  try { await backfillInbox(env.DB, user.userId); return Response.json(await inbox(env.DB, user.userId), { headers }); }
  catch { return Response.json({ error: 'Alerts could not load.' }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Invalid origin.' }, { status: 403, headers });
  if (!env.DB) return Response.json({ error: 'Alerts are unavailable.' }, { status: 503, headers });
  const text = await request.text();
  if (text.length > 300) return Response.json({ error: 'Invalid alert request.' }, { status: 400, headers });
  let body: { action?: unknown; id?: unknown };
  try { body = JSON.parse(text); } catch { return Response.json({ error: 'Invalid alert request.' }, { status: 400, headers }); }
  if (body.action === 'read' && typeof body.id === 'string' && body.id.length <= 140) {
    try { return Response.json({ marked: await markInboxRead(env.DB, user.userId, body.id) }, { headers }); }
    catch { return Response.json({ error: 'Could not mark alert read.' }, { status: 503, headers }); }
  }
  if (body.action === 'review_proposal' && typeof body.id === 'string' && body.id.length <= 140) {
    try {
      const ownership=await getOwnership(env.DB,user.userId);
      const stages=stagesForWallet(automaticStages(env),ownership?.verifiedAt?ownership.address:null);
      if(!stages.approveByNotification)return Response.json({error:'Buy ideas are off for this wallet.'},{status:403,headers});
      const claimed=await claimProposalReview(env.DB,user.userId,body.id.replace(/^proposal:/,''));
      if(!claimed)return Response.json({error:'This idea expired or was already opened. No order was sent.'},{status:409,headers});
      return Response.json({proposal:claimed,notice:'Open Buy for a fresh quote. Your wallet signature is still required.'},{headers});
    }catch{return Response.json({error:'Could not open this idea. No order was sent.'},{status:503,headers});}
  }
  if (body.action === 'test' && Object.keys(body).length === 1) {
    try {
      const item = await createTestInbox(env.DB, user.userId);
      let push = 'not enabled';
      if (env.STEWARD_VAPID_PUBLIC_KEY && env.STEWARD_VAPID_PRIVATE_KEY) {
        const result = await sendInboxPush(env.DB, user.userId, item, { publicKey: env.STEWARD_VAPID_PUBLIC_KEY, privateKey: env.STEWARD_VAPID_PRIVATE_KEY }).catch(() => ({ sent: 0 }));
        if (result.sent > 0) push = 'sent';
      }
      return Response.json({ item, push }, { headers });
    } catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : 'Test alert unavailable.' }, { status: 429, headers }); }
  }
  return Response.json({ error: 'Invalid alert action.' }, { status: 400, headers });
}
