export type AutomaticStageConfig = {
  SHADOW_MODE?: string;
  APPROVE_BY_NOTIFICATION?: string;
  APPROVE_NOTIFICATION_WALLETS?: string;
  AUTO_BUY?: string;
  AUTO_BUY_WALLETS?: string;
  AUTO_BUY_MAX_ORDER_CENTS?: string;
  AUTO_BUY_MAX_DAILY_CENTS?: string;
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
  // A notification proposal and an autonomous buy cannot act on the same run.
  const conflicting = notificationRequested && autoRequested;
  const maxOrderCents = lowCap(config.AUTO_BUY_MAX_ORDER_CENTS, 100,100);
  // The permission spans two UTC days. Each day's cap is at most $2.50,
  // making the onchain two-day total at most $5.
  const maxDailyCents = lowCap(config.AUTO_BUY_MAX_DAILY_CENTS, 200,250);
  if (maxDailyCents < maxOrderCents) throw Error('Automatic daily cap is below the order cap.');
  return {
    shadow,
    approveByNotification: shadow && notificationRequested && !conflicting,
    autoBuy: shadow && autoRequested && !conflicting,
    maxOrderCents,
    maxDailyCents,
    conflicting,
    notificationWallets: walletList(config.APPROVE_NOTIFICATION_WALLETS),
    autoWallets: walletList(config.AUTO_BUY_WALLETS),
  };
}

function walletList(raw: string | undefined): string[] {
  if (!raw) return [];
  const wallets = raw.split(',').map(value => value.trim().toLowerCase());
  if (wallets.some(value => !/^0x[0-9a-f]{40}$/.test(value))) throw Error('Invalid automatic stage wallet allowlist.');
  return [...new Set(wallets)];
}

export function stagesForWallet(stages: ReturnType<typeof automaticStages>, address: string | null | undefined) {
  const wallet = address?.toLowerCase();
  return { ...stages,
    approveByNotification: !!wallet && stages.approveByNotification && stages.notificationWallets.includes(wallet),
    autoBuy: !!wallet && stages.autoBuy && stages.autoWallets.includes(wallet),
  };
}

export function automaticStageIntent(stages:ReturnType<typeof automaticStages>,triggered:boolean,isBuy:boolean,amountCents:number):'none'|'proposal'|'auto'|'blocked'{
  if(!stages.shadow||!triggered||!isBuy)return 'none';
  if(stages.autoBuy)return amountCents<=stages.maxOrderCents?'auto':'blocked';
  if(stages.approveByNotification)return 'proposal';
  return 'none';
}
