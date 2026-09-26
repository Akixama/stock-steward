export type SetupFeeEvidence = {
  observedAt: string; ethUsdCents: number; ethPriceAt: string;
  steps: {name:'delegation'|'permission'|'revocation';executionGas:string;maxFeePerGasWei:string;dataFeeWei:string;providerFeeWei:string}[];
  // External funding/bridge fees are separate; never include investment principal here.
};
export function quoteSetup(evidence: SetupFeeEvidence, capCents: number, now = Date.now()) {
  const fresh = (date:string)=>Number.isFinite(Date.parse(date)) && now-Date.parse(date)>=0 && now-Date.parse(date)<=60000;
  if (!Number.isSafeInteger(capCents) || capCents<1 || capCents>2000 || !Number.isSafeInteger(evidence.ethUsdCents) || evidence.ethUsdCents<1 ||
    !fresh(evidence.observedAt) || !fresh(evidence.ethPriceAt) || evidence.steps.length!==3 || new Set(evidence.steps.map(s=>s.name)).size!==3 ||
    !['delegation','permission','revocation'].every(name=>evidence.steps.some(s=>s.name===name))) throw new Error('Complete fresh setup evidence and a cap of at most $20 are required.');
  let total=0n;
  for(const step of evidence.steps){
    for(const value of [step.executionGas,step.maxFeePerGasWei,step.dataFeeWei,step.providerFeeWei]) if(!/^\d{1,40}$/.test(value))throw new Error('Invalid fee evidence');
    const gas=BigInt(step.executionGas),price=BigInt(step.maxFeePerGasWei);
    if(gas===0n || price===0n)throw new Error('Gas usage and fee ceiling must be measured.');
    total+=gas*price+BigInt(step.dataFeeWei)+BigInt(step.providerFeeWei);
  }
  // 50% headroom; round every displayed budget upwards, never down.
  const bufferedWei=(total*150n+99n)/100n;
  const cents=(bufferedWei*BigInt(evidence.ethUsdCents)+10n**18n-1n)/(10n**18n);
  return {totalWei:total.toString(),bufferedWei:bufferedWei.toString(),bufferedCents:cents.toString(),withinCap:cents<=BigInt(capCents),capCents,
    excludes:'Funding/bridge fees and investment principal. Estimate is not a spending authorization.'};
}
