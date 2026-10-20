export default function OrderStatusTimeline({stage}:{stage:'submitted'|'confirming'|'confirmed'|'verified'|'reverted'|'reorged'}){
  const order=['submitted','confirmed','verified'] as const;
  const position=stage==='confirming'?0:stage==='verified'?2:stage==='confirmed'?1:0;
  return <div className="ws-v2-timeline" role="status" aria-label={`Transaction status: ${stage}`}>
    {stage==='reverted'||stage==='reorged'?<span data-state="active">{stage==='reorged'?'Chain changed · unresolved':'Reverted · awaiting finality'}</span>
      :order.map((step,index)=><span key={step} data-state={index<position?'complete':index===position?'active':'waiting'}>{step==='submitted'?'Submitted':step==='confirmed'?'Confirmed':'Finalized'}</span>)}
  </div>;
}
