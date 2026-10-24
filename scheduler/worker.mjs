const TIMEOUT_MS = 120_000;

export default {
  async scheduled(event, env) {
    const key = env.STEWARD_WORKER_KEY;
    if (!/^[a-f0-9]{64}$/.test(key ?? '')) {
      throw new Error('STEWARD_WORKER_KEY is missing or invalid.');
    }

    // Every minute: light rules pass; every 15th minute: the full monitor.
    const full = !event?.scheduledTime || new Date(event.scheduledTime).getUTCMinutes() % 15 === 0;
    const response = await fetch(env.STEWARD_TICK_URL + (full ? '' : '?fast=1'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Stock Steward tick returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (typeof result.spendingEnabled !== 'boolean' || !result.summary) {
      throw new Error('Unexpected Stock Steward tick response.');
    }
    console.log(JSON.stringify({ summary: result.summary, priceAlerts:result.priceAlerts??null, markets:result.markets??null, spendingEnabled:result.spendingEnabled }));
  },
};
