const TIMEOUT_MS = 120_000;

export default {
  async scheduled(_event, env) {
    const key = env.STEWARD_WORKER_KEY;
    if (!/^[a-f0-9]{64}$/.test(key ?? '')) {
      throw new Error('STEWARD_WORKER_KEY is missing or invalid.');
    }

    const response = await fetch(env.STEWARD_TICK_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Stock Steward tick returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (result.spendingEnabled !== false || !result.summary) {
      throw new Error('Unexpected Stock Steward tick response.');
    }
    console.log(JSON.stringify({ summary: result.summary, spendingEnabled: false }));
  },
};
