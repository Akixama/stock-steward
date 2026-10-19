export default function OrderStatusTimeline({stage}:{stage:'submitted'|'confirming'|'verified'}){
  const order=['submitted','confirming','verified'] as const;
  return <div className="ws-v2-timeline" role="status" aria-label={`Transaction status: ${stage}`}>
    {order.map((step,index)=><span key={step} data-state={index<order.indexOf(stage)?'complete':step===stage?'active':'waiting'}>{step==='submitted'?'Submitted':step==='confirming'?'Confirming':'Verified'}</span>)}
  </div>;
}
