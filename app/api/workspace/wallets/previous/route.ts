import { env } from 'cloudflare:workers';
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseAbi, type Address } from 'viem';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getOwnership } from '@/db/wallet-ownership';
import { D1DecisionLedger } from '@/db/ledger';
import { rpcCall } from '@/app/api/workspace/orders/live/_shared';
import { chainTransport } from '@/lib/chain-transport';
import { registry, USDG } from '@/lib/robinhood-chain';
import type { Mandate } from '@/lib/decision';

const ownersAbi = parseAbi(['function getOwners() view returns (address[])']);
const balanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);

// Earlier mandate versions have their own deterministic Safe. Keep their
// holdings visible when the current version needs a new permission.
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!env.DB) return Response.json({ error: 'Workspace storage is unavailable.' }, { status: 503 });
  const [current, ownership] = await Promise.all([
    new D1DecisionLedger(env.DB).getMandate(user.userId),
    getOwnership(env.DB, user.userId),
  ]);
  if (!current || !ownership?.verifiedAt) return Response.json({ wallet: null });
  const previous = await env.DB.prepare(`SELECT a.safe, a.mandate_version AS version, m.policy_json AS policy
    FROM active_modules a JOIN mandates m ON m.owner_ref=a.owner_ref AND m.version=a.mandate_version
    WHERE a.owner_ref=? AND a.mandate_version<? ORDER BY a.mandate_version DESC LIMIT 1`)
    .bind(user.userId, current.version)
    .first<{ safe: string; version: number; policy: string }>();
  if (!previous || !/^0x[0-9a-f]{40}$/i.test(previous.safe)) return Response.json({ wallet: null });
  const safe = previous.safe as Address;
  const wallet = { safe, mandateVersion: previous.version, usdg: null as string | null,
    holdings: [] as { symbol: string; tokens: string | null }[], verified: false };
  try {
    const transport = chainTransport(env.ALCHEMY_API_KEY);
    const ownersRaw = await rpcCall(safe, encodeFunctionData({ abi: ownersAbi, functionName: 'getOwners' }), 'latest', transport);
    const owners = decodeFunctionResult({ abi: ownersAbi, functionName: 'getOwners', data: ownersRaw }) as readonly string[];
    if (!owners.some(address => address.toLowerCase() === ownership.address.toLowerCase())) {
      return Response.json({ wallet: null });
    }
    wallet.verified = true;
    const mandate = JSON.parse(previous.policy) as Mandate;
    const registryResponse = await fetch('https://api.robinhood.com/rhj/assets', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!registryResponse.ok) throw new Error('Asset list unavailable');
    const tokens = registry(await registryResponse.json());
    const selected = [...new Set(mandate.allowedSymbols)].slice(0, 6)
      .map(symbol => tokens.find(token => token.symbol === symbol))
      .filter((token): token is (typeof tokens)[number] => Boolean(token));
    const balance = async (token: string) => {
      const raw = await rpcCall(token, encodeFunctionData({ abi: balanceAbi, functionName: 'balanceOf', args: [safe] }), 'latest', transport);
      return decodeFunctionResult({ abi: balanceAbi, functionName: 'balanceOf', data: raw }) as bigint;
    };
    const amounts = await Promise.allSettled([balance(USDG.contract), ...selected.map(token => balance(token.contract))]);
    wallet.usdg = amounts[0].status === 'fulfilled' ? formatUnits(amounts[0].value, 6) : null;
    wallet.holdings = selected.map((token, index) => {
      const amount = amounts[index + 1];
      return { symbol: token.symbol, tokens: amount.status === 'fulfilled' ? formatUnits(amount.value, 18) : null };
    });
  } catch { /* Show the verified wallet address even when balances cannot be read. */ }
  return Response.json({ wallet }, { headers: { 'Cache-Control': 'no-store' } });
}
