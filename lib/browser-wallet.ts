export type WalletProvider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:()=>void)=>void;removeListener?:(event:string,listener:()=>void)=>void};
export type BrowserWallet={id:string;name:string;provider:WalletProvider};
export function announcedWallet(detail:unknown):BrowserWallet|null{
 if(!detail||typeof detail!=='object')return null;
 const d=detail as {info?:{uuid?:unknown;name?:unknown};provider?:WalletProvider};
 if(typeof d.info?.uuid!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.info.uuid)||typeof d.info.name!=='string'||!d.info.name.trim()||d.info.name.length>80||typeof d.provider?.request!=='function')return null;
 return {id:d.info.uuid,name:d.info.name,provider:d.provider};
}
export async function matchingWallet(provider:WalletProvider,address:string){
 const accounts=await provider.request({method:'eth_accounts'});
 if(!Array.isArray(accounts)||!accounts.some(a=>typeof a==='string'&&a.toLowerCase()===address.toLowerCase()))throw Error('The selected wallet no longer exposes this account. Reconnect the matching account.');
 const chain=await provider.request({method:'eth_chainId'});
 if(typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==4663n)throw Error('Switch the selected wallet to Robinhood Chain before signing.');
}
export async function switchRobinhood(provider:WalletProvider){
 try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
 catch(error){if((error as {code?:number})?.code!==4902)throw error;
 await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:['https://rpc.mainnet.chain.robinhood.com/'],blockExplorerUrls:['https://robinhoodchain.blockscout.com']}]});
 await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
 const chain=await provider.request({method:'eth_chainId'});if(typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==4663n)throw Error('Network switch was not confirmed. Choose Robinhood Chain in your wallet.');
}
