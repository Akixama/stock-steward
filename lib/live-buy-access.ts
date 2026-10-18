/** Admission to the current owner-approved live-buy pilot, not proof of legal eligibility. */
export function liveBuyPilotAllowed(address:string|undefined,configured:string|undefined):boolean{
 if(!address||!/^0x[0-9a-f]{40}$/i.test(address)||!configured)return false;
 const allowlist=configured.split(',').map(value=>value.trim().toLowerCase());
 if(!allowlist.every(value=>/^0x[0-9a-f]{40}$/.test(value)))return false;
 return allowlist.includes(address.toLowerCase());
}

export const LIVE_BUY_PILOT_MESSAGE='Real-money buying is limited to the current private pilot. Markets, Alerts and Practice are available without a purchase.';
