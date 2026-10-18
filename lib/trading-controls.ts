import { liveBuyPilotAllowed, LIVE_BUY_PILOT_MESSAGE } from './live-buy-access.ts';
import { PILOT_MAX_DAILY_CENTS, PILOT_MAX_ORDER_CENTS } from './pilot-policy.ts';

export type TradingConfig = {
  PUBLIC_MODE?: string;
  STEWARD_TRADING_KILL_SWITCH?: string;
  STEWARD_LIVE_BUY_PILOT_WALLETS?: string;
  STEWARD_PUBLIC_MAX_ORDER_CENTS?: string;
  STEWARD_PUBLIC_MAX_DAILY_CENTS?: string;
};

function cap(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9][0-9]{0,7}$/.test(value)) throw Error('Invalid public trading cap configuration.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 1_000_000) throw Error('Invalid public trading cap configuration.');
  return parsed;
}

export function tradingLimits(config: TradingConfig) {
  const publicMode = config.PUBLIC_MODE === 'true';
  const maxOrderCents = publicMode ? cap(config.STEWARD_PUBLIC_MAX_ORDER_CENTS, 500) : PILOT_MAX_ORDER_CENTS;
  const maxDailyCents = publicMode ? cap(config.STEWARD_PUBLIC_MAX_DAILY_CENTS, 2_000) : PILOT_MAX_DAILY_CENTS;
  if (maxDailyCents < maxOrderCents) throw Error('Public daily cap must be at least the order cap.');
  return { publicMode, maxOrderCents, maxDailyCents };
}

export function tradingAdmission(address: string | undefined, config: TradingConfig) {
  if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) return { ok: false as const, error: 'Verify your owner wallet first.' };
  if (tradingLimits(config).publicMode || liveBuyPilotAllowed(address, config.STEWARD_LIVE_BUY_PILOT_WALLETS)) return { ok: true as const };
  return { ok: false as const, error: LIVE_BUY_PILOT_MESSAGE };
}

// Checked on every preparation and before an app-initiated wallet send. D1 is
// the live operator control; the environment setting is an emergency override.
export async function assertTradingEnabled(db: D1Database, config: TradingConfig): Promise<void> {
  if (config.STEWARD_TRADING_KILL_SWITCH === 'true') throw Error('Trading is paused. No new order action can be prepared.');
  const row = await db.prepare("SELECT disabled FROM trading_controls WHERE id=1").first<{ disabled: number }>();
  if (!row || row.disabled !== 0) throw Error('Trading is paused. No new order action can be prepared.');
}

export async function publicDailySpend(db: D1Database, owner: string, currentSafe: string, currentSafeBuyCents: number, day = new Date().toISOString().slice(0,10)) {
  const [otherBuys,actions] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM autonomy_spends WHERE owner_ref=? AND address<>? AND execution_day=? AND state IN ('reserved','submitted','unknown','confirmed')").bind(owner,currentSafe.toLowerCase(),day).first<{cents:number}>(),
    db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM wallet_action_attempts WHERE owner_ref=? AND execution_day=? AND state!='reverted'").bind(owner,day).first<{cents:number}>(),
  ]);
  if(!otherBuys||!actions||![currentSafeBuyCents,otherBuys.cents,actions.cents].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error('Daily activity cannot be verified. Orders stay locked.');
  return currentSafeBuyCents+otherBuys.cents+actions.cents;
}
