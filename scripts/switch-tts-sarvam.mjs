#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = parseEnv(envPath);
const email = env.DOGRAH_EMAIL || '91infocus@gmail.com';
const password = env.DOGRAH_PASSWORD || 'Irfan@2965';

const login = await fetch('http://localhost:8000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const ld = await login.json();
const token = ld.token || ld.access_token;
if (!token) {
  console.error('Login failed', login.status, ld);
  process.exit(1);
}

const body = {
  version: 2,
  mode: 'byok',
  byok: {
    mode: 'pipeline',
    pipeline: {
      stt: {
        provider: 'deepgram',
        api_key: env.DEEPGRAM_API_KEY,
        model: 'nova-3-general',
        language: 'multi',
      },
      llm: {
        provider: 'groq',
        api_key: env.GROQ_API_KEY,
        model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
      },
      tts: {
        provider: 'sarvam',
        api_key: env.SARVAM_API_KEY,
        model: env.SARVAM_TTS_MODEL || 'bulbul:v3',
        voice: env.SARVAM_TTS_VOICE || 'shubh',
        language: 'hi-IN',
      },
    },
  },
};

const res = await fetch('http://localhost:8000/api/v1/organizations/model-configurations/v2', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const text = await res.text();
if (res.status >= 400) {
  console.error('Update failed:', res.status, text);
  process.exit(1);
}

const get = await fetch('http://localhost:8000/api/v1/organizations/model-configurations/v2', {
  headers: { Authorization: `Bearer ${token}` },
});
const cfg = await get.json();
const tts = cfg?.byok?.pipeline?.tts || cfg?.configuration?.byok?.pipeline?.tts;
if (!tts || tts.provider !== 'sarvam') {
  console.error('Verification failed:', JSON.stringify(cfg).slice(0, 800));
  process.exit(1);
}
console.log('ok  Dograh TTS switched to', tts.provider, tts.model, tts.voice);
