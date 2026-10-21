// The live, owner-approved buying permission is intentionally short. Keep its
// duration in one place; changing it also requires a review of aggregate caps.
export const PERMISSION_WINDOW_DAYS = 2;
export const PERMISSION_WINDOW_SECONDS = PERMISSION_WINDOW_DAYS * 86_400;
export const RENEW_NOTICE_SECONDS = 12 * 3_600;

export function permissionWindow(now = new Date()) {
  const startsAt = Math.floor(now.getTime() / 86_400_000) * 86_400;
  return { startsAt, expiresAt: startsAt + PERMISSION_WINDOW_SECONDS };
}

export function renewalState(expiresAt: number, now = Date.now()) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 1) return "unavailable" as const;
  if (now >= expiresAt * 1000) return "expired" as const;
  if (now >= (expiresAt - RENEW_NOTICE_SECONDS) * 1000) return "soon" as const;
  return "active" as const;
}

export function permissionTimeRemaining(expiresAt:number,now=Date.now()):string{
  if(!Number.isSafeInteger(expiresAt)||expiresAt<1)return 'Expiry unavailable';
  const remaining=Math.max(0,expiresAt*1000-now);
  if(remaining===0)return 'Expired';
  const minutes=Math.ceil(remaining/60_000),days=Math.floor(minutes/1_440),hours=Math.floor((minutes%1_440)/60),mins=minutes%60;
  return [days?`${days}d`:null,hours?`${hours}h`:null,!days&&mins?`${mins}m`:null].filter(Boolean).join(' ')+' remaining';
}
