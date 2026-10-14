const unavailable=()=>Response.json({error:'The archived broker agent is not available. Automatic Robinhood Chain trading remains disabled.'},{status:410});
export async function GET(){return unavailable();}
export async function POST(){return unavailable();}
