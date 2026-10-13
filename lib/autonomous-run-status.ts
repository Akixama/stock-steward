import type {Hex} from 'viem';

export type AutonomousRunExecution = {
 state:'checking'|'blocked'|'submitted'|'unknown';
 why:string;
 hash?:Hex;
};

// Only public receipt data belongs in a preview record. Never include a signed
// transaction, key material or an arbitrary provider response.
export function publicRunExecution(value:AutonomousRunExecution):AutonomousRunExecution{
 if(!['checking','blocked','submitted','unknown'].includes(value.state)||typeof value.why!=='string'||value.why.length>500)throw Error('Invalid execution receipt.');
 if(value.hash&&!/^0x[0-9a-f]{64}$/i.test(value.hash))throw Error('Invalid transaction hash.');
 if(value.state==='submitted'&&!value.hash)throw Error('A submitted receipt needs its transaction hash.');
 return {state:value.state,why:value.why,...(value.hash?{hash:value.hash}:{})};
}

export function runExecutionMessage(execution?:AutonomousRunExecution|null){
 if(!execution)return 'Preview only. No execution was started by this check.';
 if(execution.state==='checking')return 'Execution check started. Its outcome has not been recorded; check purchase receipts before taking action.';
 if(execution.state==='submitted')return 'Transaction submitted. The purchase is awaiting receipt verification.';
 if(execution.state==='unknown')return 'Submission outcome uncertain. Check purchase receipts; do not submit this order again.';
 return `Purchase held. ${execution.why}`;
}
