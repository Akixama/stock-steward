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
 // The pool read for Steward's own saved price history (display only): a
 // Uniswap v4 pool id or a v3-style pool address, which side the coin is on,
 // and what it is priced in.
 spot:{kind:'v4'|'v3';pool:string;coinIs:0|1;quote:'USDG'|'ETH';quoteDecimals:number;coinDecimals:number};
 note:string;
};

// Watch-only coins need at least $250k of real liquidity (GeckoTerminal total
// reserve), one contract per name, and to be a memecoin rather than a project,
// stablecoin or wrapped token. Re-checked 2026-10-26; MOW was dropped below it.
export const MEMECOINS:readonly Memecoin[]=[
 {symbol:'PONS',name:'Pons',contract:'0x39dbed3a2bd333467115de45665cc57f813c4571',tradable:true,pool:{fee:3000,tickSpacing:60},
  chartPool:'0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a',
  spot:{kind:'v4',pool:'0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a',coinIs:0,quote:'USDG',quoteDecimals:6,coinDecimals:18},
  note:'Direct USDG pool on Uniswap v4 (0.3%), the one Steward trades.'},
 {symbol:'AI',name:'Artificial Inu',contract:'0x2e8c31162b855a2ffa90f6f8634643ad6f111e18',tradable:false,
  chartPool:'0x592e3fb7ea947506b36481025abc15baada8e1839a50fded46ecf08b3182fa96',
  spot:{kind:'v4',pool:'0x592e3fb7ea947506b36481025abc15baada8e1839a50fded46ecf08b3182fa96',coinIs:0,quote:'USDG',quoteDecimals:6,coinDecimals:18},
  note:'Watch only for now. Its pools are not set up for Steward buys.'},
 {symbol:'CASHCAT',name:'Cash Cat',contract:'0x020bfc650a365f8bb26819deaabf3e21291018b4',tradable:false,
  chartPool:'0xd42a491087a15e5afd51feb3606066cc152d2b09',
  spot:{kind:'v3',pool:'0xd42a491087a15e5afd51feb3606066cc152d2b09',coinIs:0,quote:'ETH',quoteDecimals:18,coinDecimals:18},
  note:'Trades mostly against WETH, so Steward cannot buy it yet.'},
 {symbol:'GLDSTN',name:'Goldstein',contract:'0xfce34d21a92069100e3226638140706cf03a266e',tradable:false,
  chartPool:'0x7ffd58d9ab075007d3ff9a2fa31ed8993aa918680154d87eeed1861d1683b34e',
  spot:{kind:'v4',pool:'0x7ffd58d9ab075007d3ff9a2fa31ed8993aa918680154d87eeed1861d1683b34e',coinIs:1,quote:'USDG',quoteDecimals:6,coinDecimals:18},
  note:'Watch only for now. Its pools are not set up for Steward buys.'},
 {symbol:'CLAUDE',name:'Claude (memecoin)',contract:'0xea6bd2405e4c60d18f428a50d0d16df0028c4b07',tradable:false,
  chartPool:'0x0ec4b9ca9b1bb33c008c68727d222eddce95eac52f12b143486a1628153991e4',
  spot:{kind:'v4',pool:'0x0ec4b9ca9b1bb33c008c68727d222eddce95eac52f12b143486a1628153991e4',coinIs:1,quote:'USDG',quoteDecimals:6,coinDecimals:18},
  note:'Not made by or connected to Anthropic. Watch only.'},
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
