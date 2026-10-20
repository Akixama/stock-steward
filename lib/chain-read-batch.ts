type Read = {method:string;params:unknown[]};

export async function chainReadBatch(url:string,reads:Read[],transport:typeof fetch):Promise<unknown[]>{
  const response=await transport(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(reads.map((read,index)=>({jsonrpc:'2.0',id:index+1,...read}))),
    cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Chain read unavailable. Nothing was sent.');
  let rows:unknown;
  try{rows=await response.json();}catch{throw Error('Chain read unavailable. Nothing was sent.');}
  if(!Array.isArray(rows)||rows.length!==reads.length)throw Error('Chain read unavailable. Nothing was sent.');
  return reads.map((_,index)=>{
    const matches=rows.filter((row:unknown)=>row&&typeof row==='object'&&'id' in row&&row.id===index+1);
    const row=matches[0];
    if(matches.length!==1||!row||typeof row!=='object'||!('result' in row)||'error' in row)
      throw Error('Chain read unavailable. Nothing was sent.');
    return row.result;
  });
}
