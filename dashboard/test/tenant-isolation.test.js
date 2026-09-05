'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(port, route, { method = 'GET', cookie = '', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/vaani_sess=([^;]+)/);
  return { response, json, cookie: match ? `vaani_sess=${match[1]}` : cookie };
}

test('tenant isolation blocks cross-org reads and org switch is session-bound', { timeout: 45000 }, async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaani-iso-'));
  const dbFile = path.join(dbDir, 'db.json');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    RAPIDX_DB_FILE: dbFile,
    PORT: String(port),
    DEMO_ANALYTICS: 'true',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} -r ./test/mock-dograh.cjs`.trim(),
  };

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes('ready')) ready = true;
  });

  for (let i = 0; i < 80 && !ready; i++) await wait(250);
  assert.equal(ready, true, 'server did not become ready');

  try {
    const alphaSignup = await request(port, '/api/auth/signup', {
      method: 'POST',
      body: { email: 'alpha@example.com', password: 'alpha-password-12', name: 'Alpha', company: 'Alpha Org' },
    });
    assert.equal(alphaSignup.response.status, 200);
    const alphaCookie = alphaSignup.cookie;

    const betaSignup = await request(port, '/api/auth/signup', {
      method: 'POST',
      body: { email: 'beta@example.com', password: 'beta-password-12', name: 'Beta', company: 'Beta Org' },
    });
    assert.equal(betaSignup.response.status, 200);
    const betaCookie = betaSignup.cookie;

    const alphaAgent = await request(port, '/api/agents', {
      method: 'POST',
      cookie: alphaCookie,
      body: { name: 'Alpha Secret Agent', persona: 'Alpha only', greeting: 'Hello alpha' },
    });
    assert.equal(alphaAgent.response.status, 200, JSON.stringify(alphaAgent.json));

    const betaAgents = await request(port, '/api/agents', { cookie: betaCookie });
    assert.equal(betaAgents.response.status, 200);
    assert.equal(betaAgents.json.agents.length, 0);

    const crossUpdate = await request(port, '/api/agents/update', {
      method: 'POST',
      cookie: betaCookie,
      body: { id: alphaAgent.json.agent.id, name: 'Hijacked' },
    });
    assert.ok([403, 404].includes(crossUpdate.response.status));

    const betaCredential = await request(port, '/api/credentials', {
      method: 'POST',
      cookie: betaCookie,
      body: {
        provider: 'deepgram',
        layer: 'stt',
        secret: 'dg-beta-secret-key',
        idempotencyKey: 'beta-cred-1',
      },
    });
    assert.equal(betaCredential.response.status, 201);
    assert.match(betaCredential.json.credential.maskedSuffix, /\*\*\*\*/);

    const alphaCredentials = await request(port, '/api/credentials', { cookie: alphaCookie });
    assert.equal(alphaCredentials.response.status, 200);
    assert.equal(alphaCredentials.json.credentials.length, 0);

    const betaVoice = await request(port, '/api/voice/overview?demo=true', { cookie: betaCookie });
    assert.equal(betaVoice.response.status, 200);
    assert.ok(betaVoice.json.data.kpis.calls > 0);

    const alphaVoice = await request(port, '/api/voice/overview', { cookie: alphaCookie });
    assert.equal(alphaVoice.response.status, 200);
    assert.equal(alphaVoice.json.data.empty, true);

    const forgedSwitch = await request(port, '/api/organizations/switch', {
      method: 'POST',
      cookie: betaCookie,
      body: { organizationId: alphaSignup.json.tenant.id },
    });
    assert.equal(forgedSwitch.response.status, 403);

    const alphaOrgs = await request(port, '/api/organizations', { cookie: alphaCookie });
    assert.equal(alphaOrgs.response.status, 200);
    assert.equal(alphaOrgs.json.organizations.length, 1);
    assert.equal(alphaOrgs.json.activeOrganizationId, alphaSignup.json.tenant.id);
  } finally {
    child.kill('SIGTERM');
    await wait(300);
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});
