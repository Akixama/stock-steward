import { getChatGPTUser } from '@/app/chatgpt-auth';
import { stockCatalog } from '@/lib/stock-catalog';

export async function GET() {
  if (!await getChatGPTUser()) return Response.json({ error: 'Sign in to browse stocks.' }, { status: 401 });
  try {
    const response = await fetch('https://api.robinhood.com/rhj/assets', {
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Asset registry unavailable.');
    return Response.json({ stocks: stockCatalog(await response.json()) }, {
      headers: { 'cache-control': 'private, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'The stock list is unavailable right now. Try again.' }, { status: 502 });
  }
}
