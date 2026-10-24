export type AutomaticStageConfig = {
  SHADOW_MODE?: string;
  APPROVE_BY_NOTIFICATION?: string;
  APPROVE_NOTIFICATION_WALLETS?: string;
  AUTO_BUY?: string;
  AUTO_BUY_WALLETS?: string;
  AUTO_BUY_MAX_ORDER_CENTS?: string;
  AUTO_BUY_MAX_DAILY_CENTS?: string;
  AUTO_BUY_HARD_CEILING_CENTS?: string;
  REQUIRE_INDEPENDENT_REVIEW?: string;
};

// Platform ceilings. Each owner's own Limits (per buy, per day) apply first;
// the release config can only lower these.
export const AUTO_ORDER_CEILING_CENTS = 100_000;   // $1,000 per trade
export const AUTO_DAILY_CEILING_CENTS = 500_000;   // $5,000 per day
export const AUTO_TOTAL_CEILING_CENTS = 5_000_000; // $50,000 per permission

function lowCap(raw: string | undefined, fallback: number,ceiling: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d{0,7}$/.test(raw)) throw Error('Invalid automatic buying cap.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > ceiling) throw Error('Automatic buying cap exceeds the hard safety ceiling.');
  return value;
}

export function automaticStages(config: AutomaticStageConfig) {
  const shadow = config.SHADOW_MODE === 'true';
  const notificationRequested = config.APPROVE_BY_NOTIFICATION === 'true';
  const autoRequested = config.AUTO_BUY === 'true';
  // v2: both stages may be on. Each run still takes exactly one path: an armed
  // automatic session buys, everyone else gets a proposal to approve.
  const conflicting = false;
  // Defaults stay tiny when the release config says nothing.
  const maxOrderCents = lowCap(config.AUTO_BUY_MAX_ORDER_CENTS, 100,AUTO_ORDER_CEILING_CENTS);
  const maxDailyCents = lowCap(config.AUTO_BUY_MAX_DAILY_CENTS, 200,AUTO_DAILY_CEILING_CENTS);
  // Total any one permission may spend over its whole life.
  const hardCeilingCents=lowCap(config.AUTO_BUY_HARD_CEILING_CENTS,500,AUTO_TOTAL_CEILING_CENTS);
  if(hardCeilingCents<maxDailyCents)throw Error('Automatic permission total is below one day.');
  if (maxDailyCents < maxOrderCents) throw Error('Automatic daily cap is below the order cap.');
  return {
    shadow,
    approveByNotification: shadow && notificationRequested && !conflicting,
    autoBuy: shadow && autoRequested && !conflicting,
    maxOrderCents,
    maxDailyCents,
    hardCeilingCents,
    conflicting,
    // Independent signed reviews are required unless the release config turns them off.
    requireReview: config.REQUIRE_INDEPENDENT_REVIEW !== 'false',
    notificationWallets: walletList(config.APPROVE_NOTIFICATION_WALLETS),
    autoWallets: walletList(config.AUTO_BUY_WALLETS),
  };
}

function walletList(raw: string | undefined): string[] {
  if (!raw) return [];
  const wallets = raw.split(',').map(value => value.trim().toLowerCase());
  // '*' opens a stage to every verified wallet.
  if (wallets.some(value => value !== '*' && !/^0x[0-9a-f]{40}$/.test(value))) throw Error('Invalid automatic stage wallet allowlist.');
  return [...new Set(wallets)];
}

export function stagesForWallet(stages: ReturnType<typeof automaticStages>, address: string | null | undefined) {
  const wallet = address?.toLowerCase();
  return { ...stages,
    approveByNotification: !!wallet && stages.approveByNotification && (stages.notificationWallets.includes('*') || stages.notificationWallets.includes(wallet)),
    autoBuy: !!wallet && stages.autoBuy && (stages.autoWallets.includes('*') || stages.autoWallets.includes(wallet)),
  };
}

// armed: the owner has a verified session permission and a signed Start.
// canSell: the armed permission includes a sale lot. Sells never become proposals.
export function automaticStageIntent(stages:ReturnType<typeof automaticStages>,triggered:boolean,isBuy:boolean,amountCents:number,armed=true,canSell=false):'none'|'proposal'|'auto'|'blocked'{
  if(!stages.shadow||!triggered)return 'none';
  if(!isBuy)return stages.autoBuy&&armed&&canSell?(amountCents<=stages.maxOrderCents?'auto':'blocked'):'none';
  if(stages.autoBuy&&armed)return amountCents<=stages.maxOrderCents?'auto':'blocked';
  if(stages.approveByNotification)return 'proposal';
  return 'none';
}
