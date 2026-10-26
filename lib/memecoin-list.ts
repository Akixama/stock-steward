// Hand-checked Robinhood Chain memecoins, fixed by contract address. Copycat
// tokens reuse these names, so a symbol alone never identifies a coin here.
// Checked 2026-10-26 against memecoin-probe.json and GeckoTerminal.
// No imports: robinhood-chain.ts reads this list and must not import back.
export type Memecoin={
 symbol:string;name:string;contract:string;
 // Tradable coins have a direct USDG pool with no hooks, the only route Steward
 // and its wallet permission support. Watch-only coins trade against WETH or
 // through hooked pools.
 tradable:boolean;
 // The no-hooks USDG pool Steward quotes and trades (tradable coins only).
 pool?:{fee:number;tickSpacing:number};
 // GeckoTerminal pool used for the Markets chart (display only).
 chartPool:string;
 // The Uniswap v4 pool read for Steward's own saved price history (display
 // only): which side of the pool the coin is on, and what it is priced in.
 spot:{poolId:string;coinIs:0|1;quote:'USDG'|'ETH';quoteDecimals:number;coinDecimals:number};
 note:string;
};

export const MEMECOINS:readonly Memecoin[]=[
 {symbol:'PONS',name:'Pons',contract:'0x39dbed3a2bd333467115de45665cc57f813c4571',tradable:true,pool:{fee:3000,tickSpacing:60},
  chartPool:'0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a',
  spot:{poolId:'0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a',coinIs:0,quote:'USDG',quoteDecimals:6,coinDecimals:18},
  note:'Direct USDG pool on Uniswap v4 (0.3%), the one Steward trades.'},
 {symbol:'MOW',name:'MowCat',contract:'0x0b7c6c138dc75622f4200d157b13fb93e6bd94fa',tradable:false,
  chartPool:'0x5291cfd042d8a771a510534ee31090bc4f4dc72724871e8f321aecfd12332a9a',
  spot:{poolId:'0x5291cfd042d8a771a510534ee31090bc4f4dc72724871e8f321aecfd12332a9a',coinIs:1,quote:'ETH',quoteDecimals:18,coinDecimals:18},
  note:'Trades against WETH, so Steward cannot buy it yet.'},
];

// One buy of a memecoin, at most. The wallet permission pins a single buy size
// for every token in it, so this caps the whole per-buy Limit while a memecoin is in it.
export const MEMECOIN_MAX_ORDER_CENTS=5000;
// Minimum-tokens floor locked into the permission for a memecoin: 5% under the
// signing-time quote (stocks use 0.5%). Memecoins move more, and a tighter floor
// would refuse most buys after a small rise.
export const MEMECOIN_FLOOR_BPS=500;

export function memecoin(symbol:string){return MEMECOINS.find(m=>m.symbol===symbol)??null;}
export function isMemecoin(symbol:string){return MEMECOINS.some(m=>m.symbol===symbol);}
export function tradableMemecoins(){return MEMECOINS.filter(m=>m.tradable);}

// A memecoin in the Limits caps every buy, because the permission has one size.
export function memecoinLimitError(allowedSymbols:readonly string[],maxOrderCents:number):string|null{
 const coins=allowedSymbols.filter(isMemecoin);
 if(!coins.length||maxOrderCents<=MEMECOIN_MAX_ORDER_CENTS)return null;
 return `${coins.join(' and ')} ${coins.length===1?'is a memecoin':'are memecoins'}, so each buy can be at most $${(MEMECOIN_MAX_ORDER_CENTS/100).toFixed(0)} while ${coins.length===1?'it is':'they are'} in your Limits. Lower your per-buy amount or remove ${coins.length===1?'it':'them'}.`;
}
