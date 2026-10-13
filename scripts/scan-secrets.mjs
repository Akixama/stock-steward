import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/, 'AKIA[0-9A-Z]{16}'],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, 'gh[pousr]_[A-Za-z0-9_]{20,}'],
  ['openai-token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/, 'sk-(proj-)?[A-Za-z0-9_-]{20,}'],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/, 'xox[baprs]-[A-Za-z0-9-]{16,}'],
  ['stripe-live-key', /\bsk_live_[A-Za-z0-9]{16,}\b/, 'sk_live_[A-Za-z0-9]{16,}'],
];
const skipped = new Set(['.git', 'node_modules', 'dist', '.next', '.vinext', '.wrangler', '.sites-runtime', 'outputs']);
const findings = [];

function scanFile(file) {
  if (file.endsWith('scripts/scan-secrets.mjs') || !existsSync(file) || statSync(file).size > 2_000_000) return;
  const value = readFileSync(file);
  if (value.includes(0)) return;
  const text = value.toString('utf8');
  for (const [type, regex] of patterns) if (regex.test(text)) findings.push({ scope: 'working-tree', file: file.replaceAll('\\', '/'), type });
}
function walk(dir = '.') {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file); else scanFile(relative('.', file));
  }
}
walk();

for (const [type, , expression] of patterns) {
  const output = execFileSync('git', ['log', '--all', `-G${expression}`, '--format=commit:%H', '--name-only', '--', '.', ':(exclude)scripts/scan-secrets.mjs'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let commit = '';
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('commit:')) commit = line.slice(7);
    else if (commit && line.trim()) findings.push({ scope: 'history', commit, file: line.trim().replaceAll('\\', '/'), type });
  }
}

const unique = [...new Map(findings.map(item => [JSON.stringify(item), item])).values()];
console.log(JSON.stringify({ findings: unique, findingCount: unique.length }, null, 2));
if (unique.length) process.exitCode = 1;
