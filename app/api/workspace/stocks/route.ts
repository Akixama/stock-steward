import { getChatGPTUser } from '@/app/chatgpt-auth';
import { stockCatalog } from '@/lib/stock-catalog';
import { tradableMemecoins } from '@/lib/memecoin-list';

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return Response.json({ error: 'Sign in to browse stocks.' }, { status: 401 });
  try {
    const response = await fetch('https://api.robinhood.com/rhj/assets', {
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Asset registry unavailable.');
    const stocks = stockCatalog(await response.json());
    // The Limits picker asks for the hand-checked memecoins Steward can trade, too.
    if (new URL(request.url).searchParams.get('memecoins') === '1') for (const coin of tradableMemecoins()) if (!stocks.some((stock) => stock.symbol === coin.symbol)) stocks.push({ symbol: coin.symbol, name: coin.name, kind: 'memecoin' });
    return Response.json({ stocks }, {
      headers: { 'cache-control': 'private, max-age=300' },
    });
  } catch {
    return Response.json({ error: 'The stock list is unavailable right now. Try again.' }, { status: 502 });
  }
}
