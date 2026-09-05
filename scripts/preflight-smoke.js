'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) return;
  for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.join(__dirname, '..', 'dashboard', '.env'));

const providers = require(path.join(__dirname, '..', 'dashboard', 'lib', 'providers'));

async function run(name, fn) {
  try {
    await fn();
    return { name, pass: true };
  } catch (error) {
    return { name, pass: false };
  }
}

async function main() {
  const results = [];

  if (process.env.DEEPGRAM_API_KEY) {
    results.push(await run('Deepgram', async () => {
      const token = await providers.stt.mintToken();
      if (!token.access_token) throw new Error('missing token');
    }));
  } else {
    results.push({ name: 'Deepgram', pass: false, skipped: 'no key' });
  }

  if (process.env.GROQ_API_KEY) {
    for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
      results.push(await run(`Groq ${model}`, async () => {
        const out = await providers.get('llm', 'groq').chat({
          model,
          messages: [{ role: 'user', text: 'Reply with OK only.' }],
        });
        if (!out.text) throw new Error('empty response');
      }));
    }
  } else {
    results.push({ name: 'Groq openai/gpt-oss-120b', pass: false, skipped: 'no key' });
    results.push({ name: 'Groq openai/gpt-oss-20b', pass: false, skipped: 'no key' });
  }

  if (process.env.RUMIK_API_KEY) {
    results.push(await run('Rumik', async () => {
      const session = await providers.get('tts', 'rumik').wsConnect({ text: 'ok', model: 'mulberry' });
      if (!session || !session.ws_url) throw new Error('missing ws_url');
    }));
  } else {
    results.push({ name: 'Rumik', pass: false, skipped: 'no key' });
  }

  for (const row of results) {
    const status = row.skipped ? 'skip' : (row.pass ? 'pass' : 'fail');
    console.log(`${row.name}: ${status}`);
  }
}

main().catch(() => process.exit(1));
