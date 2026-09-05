import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const metrics = await fetch('http://localhost:2000/metrics').then((r) => r.text()).catch(() => '');
const tunnelMatch = metrics.match(/userHostname="(https:\/\/[^"]+)"/);
const tunnel = tunnelMatch ? tunnelMatch[1] : null;
const base = env.DOGRAH_BASE_URL;
console.log('env DOGRAH_BASE_URL', base);
console.log('live tunnel', tunnel);
for (const url of [base, tunnel, 'http://localhost:8000'].filter(Boolean)) {
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/api/v1/health', { signal: AbortSignal.timeout(5000) });
    console.log('health', url, r.status);
  } catch (e) {
    console.log('health', url, 'FAIL', e.cause?.code || e.message);
  }
}
