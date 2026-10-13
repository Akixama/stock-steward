import {evaluateExecution,type ExecutionEvidence} from './execution-guard.ts';
import {executionAccounting,executionSaleAccounting,type AccountingEvidence,type AccountingLimits} from './execution-accounting.ts';
import {routerCandidate,validateRouterCandidate,type RouterCandidate} from './router-candidate.ts';
// Internal review boundary. It has no signer, RPC submission or database side effects.
export function reviewExecution(e:ExecutionEvidence,accounting:AccountingEvidence,limits:AccountingLimits,candidate:RouterCandidate,now=Date.now()){
 const guard=evaluateExecution(e,now);
 const sale=e.route.side==='sell';
 const money=(sale?executionSaleAccounting:executionAccounting)(accounting,e.route.inputRaw,limits,now);
 const reasons=[...guard.reasons];
 if(sale&&(!accounting.sale||accounting.sale.inputToken.toLowerCase()!==e.route.token.toLowerCase()||accounting.sale.outputToken.toLowerCase()!==e.route.settlement.toLowerCase()||accounting.sale.minimumOutputRaw!==e.route.minimumOutputRaw))reasons.push('Sale accounting currencies or minimum proceeds differ from the exact route.');
 if(!sale&&accounting.sale)reasons.push('Sale accounting cannot authorize a purchase.');
 const accountBound=accounting.address.toLowerCase()===e.route.address.toLowerCase()&&accounting.chainId===e.route.chainId&&accounting.blockHash===e.route.blockHash;
 if(!accountBound)reasons.push('Accounting belongs to a different account, chain or block.');
 if(!money.checksPassed)reasons.push('Complete fresh dollar accounting did not pass.');
 let exactCandidate=false;try{const expected=routerCandidate(e.route,e.mandateVersion);exactCandidate=validateRouterCandidate(e.route,e.mandateVersion,candidate)&&candidate.intentDigest===expected.intentDigest&&candidate.calldataHash===expected.calldataHash&&candidate.sourceRevision===expected.sourceRevision&&candidate.submissionEnabled===false;}catch{/* Unbounded or malformed candidates stay blocked. */}
 if(!exactCandidate)reasons.push('Router candidate or its intent fingerprint changed.');
 return {schema:'stock-steward-execution-review-v1',observedAt:new Date(now).toISOString(),intentDigest:e.intentDigest,accountingDigest:money.digest,checksPassed:reasons.length===0,reasons,accounting:money,executionEnabled:false as const,submissionAvailable:false as const,why:'Internal review only. No verified permission installer, delegated-account simulator, signer or submission adapter is connected.'};
}
