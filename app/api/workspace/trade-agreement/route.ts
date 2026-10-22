import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ipLocationBlock, saveTradeAgreement, tradeAgreement } from '@/lib/trade-agreement';
import { TERMS_VERSION, TRADE_AGREEMENT_LABEL, TRADING_RISK_TEXT, US_RESTRICTION_TEXT } from '@/config/public-launch-copy';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  if (!env.DB) return Response.json({ error: 'Workspace storage unavailable.' }, { status: 503, headers });
  try {
    return Response.json({ ...(await tradeAgreement(env.DB, user.userId)),
      locationBlock: ipLocationBlock(request, env), label: TRADE_AGREEMENT_LABEL,
      risk: TRADING_RISK_TEXT, restriction: US_RESTRICTION_TEXT }, { headers });
  } catch { return Response.json({ error: 'Agreement status could not be checked. Trading remains blocked.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Invalid request origin.' }, { status: 403, headers });
  if (!env.DB) return Response.json({ error: 'Workspace storage unavailable.' }, { status: 503, headers });
  const location = ipLocationBlock(request, env);
  if (location) return Response.json({ error: location }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { accepted?: unknown; termsVersion?: unknown } | null;
  if (body?.accepted !== true || body.termsVersion !== TERMS_VERSION)
    return Response.json({ error: 'Read and accept the current terms before trading.' }, { status: 400, headers });
  try { return Response.json(await saveTradeAgreement(env.DB, user.userId), { headers }); }
  catch { return Response.json({ error: 'Agreement could not be saved. Trading remains blocked.' }, { status: 503, headers }); }
}
