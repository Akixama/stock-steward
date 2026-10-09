import {D1DecisionLedger} from '../db/ledger.ts';
import {tickPracticeSessions} from '../db/practice-sessions.ts';
import {recoverExecutionAttempts} from './execution-recovery.ts';
import {getOwnership} from '../db/wallet-ownership.ts';
import {claimWorker,finishWorker,dueSchedules,claimSchedule,claimCurrent,finishSchedule} from '../db/scheduler.ts';
import {refreshWatch} from '../db/transaction-watches.ts';
import {reconcileTransaction,type TransactionWatch} from './chain-reconciliation.ts';
import {readChain} from './robinhood-chain.ts';
import {enrichObservation} from './chain-analysis.ts';
import {autonomyReadiness,readInfrastructure,attachHistoricalControl} from './autonomy.ts';
import {listSpendEvidence} from '../db/execution-attempts.ts';
import {liveAccountingSection,alchemyAccountingSources,grantGateSection} from './live-evidence.ts';
import {tickAgentDecisions} from './agent-worker.ts';
export async function workerTick(db:D1Database,fetcher:typeof fetch=fetch){
  const token=await claimWorker(db);if(!token)return {busy:true,observed:0,failed:0,reconciled:0};
  const summary={busy:false,observed:0,failed:0,canceled:0,reconciled:0,executionRecovered:0,executionSettled:0,executionUnresolved:0,practiceUpdated:0,practiceFailed:0,batchState:'completed',agent:{due:0,held:0,decided:0,submitted:0,unknown:0,aborted:0,skipped:0,failed:0}};
  try {
    const practice=await tickPracticeSessions(db,Date.now(),true);summary.practiceUpdated=practice.updated;summary.practiceFailed=practice.failed;
    for(const schedule of await dueSchedules(db)){
      const claim=await claimSchedule(db,schedule);if(!claim)continue;
      let observation=null,receipt=null;
      try {
        if(!await claimCurrent(db,claim)){await finishSchedule(db,claim,null,null);continue;}
        const ledger=new D1DecisionLedger(db);
        const mandate=await ledger.getMandate(schedule.owner_ref);
        observation=await enrichObservation(await readChain(schedule.address,fetcher),mandate);
        let infrastructure=null;try{infrastructure=await readInfrastructure(fetcher);}catch{/* Account evidence remains visible when infrastructure fails. */}
        receipt=autonomyReadiness(schedule.address,mandate,infrastructure);
        attachHistoricalControl(receipt,await getOwnership(db,schedule.owner_ref));
        // Live dollar evidence and the grant gate ride along on the same scheduled read.
        const spendEvidence=await listSpendEvidence(db,schedule.owner_ref,schedule.address).catch(()=>null);
        receipt.liveAccounting=await liveAccountingSection(schedule.address,mandate,spendEvidence,alchemyAccountingSources(fetcher,fetcher));
        receipt.grantGate=grantGateSection([],await ledger.getMandateSnapshot(schedule.owner_ref).catch(()=>null));
        receipt.workerRunId=claim.runId;receipt.trigger='scheduled';
        receipt.observationId=observation.id;
      }catch{/* No fabricated financial decision on an unavailable observation. */}
      const result=await finishSchedule(db,claim,observation,receipt);
      if(result?.status==='observed')summary.observed++;else if(result?.status==='error')summary.failed++;else summary.canceled++;
    }
    const cutoff=new Date(Date.now()-15*60000).toISOString();
    const watches=await db.prepare('SELECT owner_ref,record_json,checked_at FROM chain_transaction_watches WHERE checked_at<=? ORDER BY checked_at LIMIT 3').bind(cutoff).all<{owner_ref:string;record_json:string;checked_at:string}>();
    for(const row of watches.results){const previous=JSON.parse(row.record_json) as TransactionWatch;
      const next=await reconcileTransaction(previous.address,previous.hash,previous,fetcher);await refreshWatch(db,row.owner_ref,next,row.checked_at);summary.reconciled++;}
    const recovery=await recoverExecutionAttempts(db,fetcher);
    summary.executionRecovered=recovery.recovered;summary.executionSettled=recovery.settled;summary.executionUnresolved=recovery.unresolved;
    summary.agent=await tickAgentDecisions(db);
    return summary;
  }catch(error){summary.batchState='error';throw error;}
  finally{await finishWorker(db,token,summary);}
}
