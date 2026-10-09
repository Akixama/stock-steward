import {concat,encodeAbiParameters,encodeFunctionData,encodePacked,getContractAddress,keccak256,parseAbi,parseAbiParameters,type Address,type Hex} from 'viem';
export const SAFE_CONTRACTS={singleton:'0x41675C099F32341bf84BFc5382aF534df5C7461a',factory:'0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'} as const;
export const SAFE_RUNTIME_HASHES={singleton:'0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4',factory:'0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317',proxy:'0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'} as const;
export const safeSetupAbi=parseAbi(['function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)']);
export const safeFactoryAbi=parseAbi(['function proxyCreationCode() pure returns (bytes)','function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)','event ProxyCreation(address indexed proxy,address singleton)']);
const ZERO='0x0000000000000000000000000000000000000000';
export function safeSetupPlan(owner:Address,nonce:Hex,creationCode:Hex){
 if(!/^0x[0-9a-f]{40}$/i.test(owner)||owner.toLowerCase()===ZERO||!/^0x[0-9a-f]{64}$/i.test(nonce)||!/^0x(?:[0-9a-f]{2}){50,1000}$/i.test(creationCode))throw Error('Invalid safe setup');
 const initializer=encodeFunctionData({abi:safeSetupAbi,functionName:'setup',args:[[owner],1n,ZERO,'0x',ZERO,ZERO,0n,ZERO]});
 const salt=keccak256(encodePacked(['bytes32','uint256'],[keccak256(initializer),BigInt(nonce)]));
 const bytecode=concat([creationCode,encodeAbiParameters(parseAbiParameters('uint256'),[BigInt(SAFE_CONTRACTS.singleton)])]);
 const account=getContractAddress({opcode:'CREATE2',from:SAFE_CONTRACTS.factory,salt,bytecode});
 return {chainId:4663,owner,account,initializer,call:{to:SAFE_CONTRACTS.factory,data:encodeFunctionData({abi:safeFactoryAbi,functionName:'createProxyWithNonce',args:[SAFE_CONTRACTS.singleton,initializer,BigInt(nonce)]}),value:'0x0' as const},installationEnabled:false as const,why:'Owner-only wallet setup calldata. No worker, fallback handler, module, token approval or payment is installed. Actual factory runtime, creation code, owner control, complete fees and explicit signing must be verified first.'};
}
