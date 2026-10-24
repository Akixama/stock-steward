// Gathers the saved value check and recent activity for one Steward wallet, then runs the
// "max in one stock" check. Read-only: used before a buy is prepared and by the Buy checker.
import { listChainObservations } from '../db/chain-observations.ts';
import { buysSinceCents, outflowSince } from '../db/position-activity.ts';
import { positionLimitCheck, type PositionLimitResult } from './position-limit.ts';

export async function checkPositionLimit(db: D1Database, owner: string, safe: string, symbol: string, buyCents: number, maxPositionBps: number, now = Date.now()): Promise<PositionLimitResult> {
  const [latest] = await listChainObservations(db, owner, safe);
  const since = latest?.observedAt ?? new Date(now).toISOString();
  const [bought, outflow] = await Promise.all([buysSinceCents(db, owner, safe, symbol, since), outflowSince(db, owner, safe, since)]);
  return positionLimitCheck({ observation: latest ?? null, safe, symbol, buyCents, maxPositionBps, buysSinceCents: bought, outflowSinceCheck: outflow, now });
}
