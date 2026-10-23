import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { InboxItem } from '../db/notification-inbox.ts';

type Device = { endpoint: string; p256dh: string; auth: string };
export async function sendInboxPush(db: D1Database, owner: string, item: InboxItem,
  keys: { publicKey: string; privateKey: string }, fetcher: typeof fetch = fetch): Promise<{ sent: number }> {
  if (!keys.publicKey || !keys.privateKey) return { sent: 0 };
  const devices = (await db.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE owner_ref=? LIMIT 8').bind(owner).all<Device>()).results;
  let sent = 0;
  for (const device of devices) {
    try {
      const payload = await buildPushPayload({ data: JSON.stringify({ id: item.id, title: item.title, body: item.body,
        url: `https://stocksteward.app/workspace?view=alerts` }), options: { ttl: 3600 } },
      { endpoint: device.endpoint, expirationTime: null, keys: { p256dh: device.p256dh, auth: device.auth } },
      { subject: 'https://stocksteward.app', ...keys });
      const response = await fetcher(device.endpoint, { ...payload, signal: AbortSignal.timeout(8000) });
      if (response.ok) sent++;
    } catch { /* The in-app alert is already saved; device delivery is optional. */ }
  }
  return { sent };
}
