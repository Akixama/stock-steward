const unavailable=()=>Response.json({error:'Broker checks are not available. Use Practice or the Robinhood Chain wallet flow.'},{status:410});
export async function GET(){return unavailable();}
export async function POST(){return unavailable();}
