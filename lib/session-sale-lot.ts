import type {RolesPolicy} from './roles-permission.ts';
export const SELL_RULE_KINDS=['sell_below','sell_threshold','sell_scheduled'] as const;
export type SellRuleKind=typeof SELL_RULE_KINDS[number];
export const isSellKind=(kind:string):kind is SellRuleKind=>(SELL_RULE_KINDS as readonly string[]).includes(kind);

// How far below the trigger price an automatic sale may fill before the
// onchain floor rejects it. A stop-loss needs more room: prices are falling.
export const SALE_FLOOR_BPS:Record<SellRuleKind,number>={sell_below:9000,sell_threshold:9700,sell_scheduled:8500};

// One fixed sale lot for the session permission. The quantity is worth at most
// amountCents at the current upper price; the minimum USDG proceeds are encoded
// onchain, so a sale below the floor cannot execute.
export function saleLot(input:{output:{token:string;fee:number;tickSpacing:number};decimals:number;amountCents:number;kind:SellRuleKind;thresholdCents:number;priceUpperMicroUsd:bigint;priceLowerMicroUsd:bigint}):NonNullable<RolesPolicy['sales']>[number]{
 const {output,decimals,amountCents,kind,thresholdCents,priceUpperMicroUsd,priceLowerMicroUsd}=input;
 if(!Number.isSafeInteger(decimals)||decimals<0||decimals>36)throw Error('Unknown token decimals.');
 if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>1000)throw Error('Sale amount must be $0.01 to $10.');
 if(priceUpperMicroUsd<=0n||priceLowerMicroUsd<=0n||priceLowerMicroUsd>priceUpperMicroUsd)throw Error('Fresh price bounds required.');
 if(kind!=='sell_scheduled'&&(!Number.isSafeInteger(thresholdCents)||thresholdCents<1))throw Error('Sale trigger price required.');
 const scale=10n**BigInt(decimals);
 const inputRaw=BigInt(amountCents)*10_000n*scale/priceUpperMicroUsd;
 if(inputRaw<=0n)throw Error('Sale amount is below one token unit.');
 const reference=kind==='sell_scheduled'?priceLowerMicroUsd:BigInt(thresholdCents)*10_000n;
 const floorMicro=reference*BigInt(SALE_FLOOR_BPS[kind])/10_000n;
 const minimumOutputRaw=inputRaw*floorMicro/scale;
 if(minimumOutputRaw<=0n)throw Error('Sale proceeds floor rounds to zero.');
 return {token:output.token as `0x${string}`,fee:output.fee,tickSpacing:output.tickSpacing,inputRaw:inputRaw.toString(),minimumOutputRaw:minimumOutputRaw.toString()};
}
