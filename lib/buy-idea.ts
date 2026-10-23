export type BuyIdea={symbol:string;amountCents:number};

export function buyIdeaFromClaim(value:unknown):BuyIdea{
  if(!value||typeof value!=='object')throw Error('This idea could not open. No order was sent.');
  const proposal=value as {symbol?:unknown;amount_cents?:unknown};
  if(typeof proposal.symbol!=='string'||!(/^[A-Z][A-Z0-9.]{0,7}$/).test(proposal.symbol)||
    !Number.isSafeInteger(proposal.amount_cents)||Number(proposal.amount_cents)<1)
    throw Error('This idea could not open. No order was sent.');
  return {symbol:proposal.symbol,amountCents:Number(proposal.amount_cents)};
}

export function buyIdeaAmount(ideaAmountCents:number,savedAmountCents:number){
  const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
  return {
    differs:ideaAmountCents!==savedAmountCents,
    label:ideaAmountCents===savedAmountCents
      ?`Your idea and saved per-buy amount both say ${money(savedAmountCents)}.`
      :`This idea suggested ${money(ideaAmountCents)}, but your saved per-buy amount is ${money(savedAmountCents)}. This review will use ${money(savedAmountCents)}, not the idea amount.`,
  };
}
