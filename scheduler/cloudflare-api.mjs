import { readFile } from 'node:fs/promises';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const script = 'stock-steward-scheduler';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}`;
const command = process.argv[2];

if (!/^[a-f0-9]{32}$/.test(account ?? '') || !token) throw new Error('Cloudflare account and token are required.');

async function api(path, method = 'GET', body, root = base) {
  const response = await fetch(`${root}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!(body instanceof FormData) && body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    const reasons = (data.errors ?? []).map(error => `${error.code}: ${error.message}`).join('; ');
    throw new Error(`Cloudflare HTTP ${response.status}${reasons ? ` (${reasons})` : ''}`);
  }
  return data.result;
}

if (command === 'upload') {
  const form = new FormData();
  form.append('metadata', JSON.stringify({
    main_module: 'worker.mjs',
    compatibility_date: '2026-10-02',
    bindings: [{ type: 'plain_text', name: 'STEWARD_TICK_URL', text: 'https://stock-steward.stock-steward-be4a66a9.workers.dev/api/internal/autonomy/tick' }],
  }));
  const bytes = await readFile(new URL('./worker.mjs', import.meta.url));
  form.append('worker.mjs', new Blob([bytes], { type: 'application/javascript+module' }), 'worker.mjs');
  const result = await api('', 'PUT', form);
  console.log(JSON.stringify({ uploaded: true, script: result.id ?? script }));
} else if (command === 'secret') {
  const file = process.env.STEWARD_WORKER_KEY_FILE;
  if (!file) throw new Error('STEWARD_WORKER_KEY_FILE is required.');
  const key = (await readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Worker key must be 64 lowercase hex characters.');
  await api('/secrets', 'PUT', { name: 'STEWARD_WORKER_KEY', text: key, type: 'secret_text' });
  console.log(JSON.stringify({ secretConfigured: true }));
} else if (command === 'subdomain') {
  const accountBase = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
  const subdomain = `stock-steward-${account.slice(0, 8)}`;
  const result = await api('/subdomain', 'PUT', { subdomain }, accountBase);
  if (result.subdomain !== subdomain) throw new Error('Workers subdomain was not confirmed.');
  await api('/subdomain', 'POST', { enabled: false, previews_enabled: false });
  console.log(JSON.stringify({ subdomainConfigured: true, workerPublicRouteEnabled: false }));
} else if (command === 'schedule') {
  await api('/schedules', 'PUT', [{ cron: '*/15 * * * *' }]);
  const result = await api('/schedules');
  if (!result.schedules?.some(schedule => schedule.cron === '*/15 * * * *')) throw new Error('Cron trigger was not confirmed.');
  console.log(JSON.stringify({ cronConfigured: true, schedules: result.schedules.map(schedule => schedule.cron) }));
} else if (command === 'status') {
  const [schedule, secrets] = await Promise.all([api('/schedules'), api('/secrets')]);
  console.log(JSON.stringify({ schedules: schedule.schedules?.map(item => item.cron), hasWorkerKey: secrets.some?.(item => item.name === 'STEWARD_WORKER_KEY') ?? false }));
} else {
  throw new Error('Use upload, secret, subdomain, schedule, or status.');
}
