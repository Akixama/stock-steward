const unavailable=()=>Response.json({error:'This broker connection has been archived. Use the Robinhood Chain wallet flow.'},{status:410});
export async function GET(){return unavailable();}
export async function POST(){return unavailable();}
