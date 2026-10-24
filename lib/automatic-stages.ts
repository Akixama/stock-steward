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

function lowCap(raw: string | undefined, fallback: number,ceiling: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9]\d{0,4}$/.test(raw)) throw Error('Invalid automatic buying cap.');
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
  const maxOrderCents = lowCap(config.AUTO_BUY_MAX_ORDER_CENTS, 100,100);
  // The permission spans two UTC days. Each day's cap is at most $2.50,
  // making the onchain two-day total at most $5.
  const maxDailyCents = lowCap(config.AUTO_BUY_MAX_DAILY_CENTS, 200,250);
  const hardCeilingCents=lowCap(config.AUTO_BUY_HARD_CEILING_CENTS,500,500);
  if(maxDailyCents*2>hardCeilingCents)throw Error('Automatic two-day total exceeds the hard ceiling.');
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
export function automaticStageIntent(stages:ReturnType<typeof automaticStages>,triggered:boolean,isBuy:boolean,amountCents:number,armed=true):'none'|'proposal'|'auto'|'blocked'{
  if(!stages.shadow||!triggered||!isBuy)return 'none';
  if(stages.autoBuy&&armed)return amountCents<=stages.maxOrderCents?'auto':'blocked';
  if(stages.approveByNotification)return 'proposal';
  return 'none';
}
