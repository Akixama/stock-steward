import {reconcileWalletAction,type SavedWalletAction} from './wallet-action-reconcile.ts';
import {earlyConfirmationCount} from './confirmation-status.ts';

type Row=SavedWalletAction&{id:string;owner_ref:string;state:string};
export async function settleWalletActionsInBackground(db:D1Database,fetcher:typeof fetch=fetch,confirmationBlocks=earlyConfirmationCount()){
  const rows=(await db.prepare("SELECT * FROM wallet_action_attempts WHERE state IN ('submitted','unknown') AND transaction_hash IS NOT NULL ORDER BY updated_at LIMIT 3").all<Row>()).results;
  let finalized=0,unresolved=0;
  for(const row of rows){
    const proof=await reconcileWalletAction(row,fetcher,confirmationBlocks);
    if(proof.state!=='confirmed'&&proof.state!=='reverted'){unresolved++;continue;}
    const changed=await db.prepare("UPDATE wallet_action_attempts SET state=?,updated_at=? WHERE owner_ref=? AND id=? AND transaction_hash=? AND state IN ('submitted','unknown')")
      .bind(proof.state,new Date().toISOString(),row.owner_ref,row.id,row.transaction_hash).run();
    if(changed.meta.changes===1)finalized++;
  }
  return {finalized,unresolved,transactionsSent:0};
}
