#!/usr/bin/env node
/**
 * Bootstrap a fresh local Dograh stack: signup, pipeline, VoiceLink (primary)
 * and VoBiz (secondary) telephony, VaapasAI recovery workflow, API key,
 * and embed token. Updates root .env and dashboard/.env with the new IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const dashEnvPath = path.join(root, 'dashboard', '.env');
const workflowPath = path.join(root, 'workflows', 'vaapas-recovery-agent.json');

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function upsertEnv(file, updates) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const map = new Map();
  const other = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m) {
      map.set(m[1], line);
    } else {
      other.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    map.set(key, `${key}=${value}`);
  }
  const merged = [...map.values(), ...other.filter((l, i, arr) => !(i === arr.length - 1 && l === ''))];
  fs.writeFileSync(file, merged.join('\n').replace(/\n*$/, '\n'));
}

async function http(method, urlPath, body, token) {
  const res = await fetch(`http://localhost:8000${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, text };
}

async function getTunnelUrl() {
  try {
    const res = await fetch('http://localhost:2000/metrics');
    const metrics = await res.text();
    const match = metrics.match(/userHostname="(https:\/\/[^"]+trycloudflare\.com[^"]*)"/);
    return match ? match[1] : 'http://localhost:8000';
  } catch {
    return 'http://localhost:8000';
  }
}

async function main() {
  const env = parseEnv(envPath);
  const email = env.DOGRAH_EMAIL || '91infocus@gmail.com';
  const password = env.DOGRAH_PASSWORD || 'Irfan@2965';
  const tunnel = await getTunnelUrl();
  const wsTunnel = tunnel.replace(/^http/, 'ws');

  let login = await http('POST', '/api/v1/auth/login', { email, password });
  let token = login.data?.token || login.data?.access_token || '';
  if (!token) {
    const signup = await http('POST', '/api/v1/auth/signup', {
      email,
      password,
      name: 'Vaani AI Admin',
    });
    if (signup.status >= 400) {
      console.error('Signup failed:', signup.status, signup.text);
      process.exit(1);
    }
    token = signup.data?.access_token || signup.data?.token || '';
  }
  if (!token) {
    console.error('Could not obtain Dograh auth token');
    process.exit(1);
  }
  console.log('ok  Dograh authenticated');

  const pipelineBody = {
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
        tts: env.SARVAM_API_KEY ? {
          provider: 'sarvam',
          api_key: env.SARVAM_API_KEY,
          model: env.SARVAM_TTS_MODEL || 'bulbul:v3',
          voice: env.SARVAM_TTS_VOICE || 'shubh',
          language: 'hi-IN',
        } : {
          provider: 'rumik',
          api_key: env.RUMIK_API_KEY,
          model: env.RUMIK_MODEL || 'mulberry',
          voice: env.RUMIK_VOICE || 'ira',
          description: 'a warm 30s indian hindi-english voice, respectful and calm, like a helpful collections advisor',
          temperature: 0.6,
          top_p: 0.95,
          top_k: 50,
          full_response_aggregation: true,
        },
      },
    },
  };
  const model = await http('PUT', '/api/v1/organizations/model-configurations/v2', pipelineBody, token);
  if (model.status >= 400) {
    console.error('Model pipeline failed:', model.status, model.text);
    process.exit(1);
  }
  console.log(`ok  Model pipeline configured (deepgram + groq + ${env.SARVAM_API_KEY ? 'sarvam' : 'rumik'})`);

  const vlCfg = await http('POST', '/api/v1/organizations/telephony-configs', {
    name: 'VoiceLink Primary',
    is_default_outbound: true,
    config: {
      provider: 'voicelink',
      username: env.VOICELINK_RESELLER_USER,
      password: env.VOICELINK_RESELLER_PASS,
      did_number: String(env.VOICELINK_DID || '').replace(/^\+/, ''),
      from_numbers: [String(env.VOICELINK_DID || '').replace(/^\+/, '')],
    },
  }, token);
  if (vlCfg.status >= 400) {
    console.error('VoiceLink telephony config failed:', vlCfg.status, vlCfg.text);
    process.exit(1);
  }
  const vlCfgId = vlCfg.data.id;
  console.log('ok  VoiceLink telephony config', vlCfgId);

  const vlPn = await http('POST', `/api/v1/organizations/telephony-configs/${vlCfgId}/phone-numbers`, {
    address: env.VOICELINK_DID || '+919429396670',
    country_code: 'IN',
    label: 'VoiceLink DID',
    is_active: true,
    is_default_caller_id: true,
  }, token);
  if (vlPn.status >= 400) {
    console.error('VoiceLink phone number failed:', vlPn.status, vlPn.text);
    process.exit(1);
  }
  const vlPnId = vlPn.data.id;
  console.log('ok  VoiceLink phone number', vlPnId);

  const vbCfg = await http('POST', '/api/v1/organizations/telephony-configs', {
    name: 'VoBiz Secondary',
    is_default_outbound: false,
    config: {
      provider: 'vobiz',
      auth_id: env.VOBIZ_AUTH_ID,
      auth_token: env.VOBIZ_AUTH_TOKEN,
      from_numbers: [String(env.VOBIZ_NUMBER || '').replace(/^\+/, '')],
    },
  }, token);
  if (vbCfg.status >= 400) {
    console.error('VoBiz telephony config failed:', vbCfg.status, vbCfg.text);
    process.exit(1);
  }
  const vbCfgId = vbCfg.data.id;
  console.log('ok  VoBiz telephony config', vbCfgId);

  const vbPn = await http('POST', `/api/v1/organizations/telephony-configs/${vbCfgId}/phone-numbers`, {
    address: env.VOBIZ_NUMBER || '+918065354620',
    country_code: 'IN',
    label: 'VoBiz Outbound',
    is_active: true,
    is_default_caller_id: true,
  }, token);
  let vbPnId = vbPn.data?.id;
  if (vbPn.status === 409) {
    const existing = await http('GET', `/api/v1/organizations/telephony-configs/${vbCfgId}/phone-numbers`, null, token);
    const rows = Array.isArray(existing.data?.phone_numbers) ? existing.data.phone_numbers : [];
    vbPnId = rows[0]?.id;
    if (!vbPnId) {
      const legacy = await http('GET', `/api/v1/organizations/telephony-configs/2/phone-numbers`, null, token);
      const legacyRows = Array.isArray(legacy.data?.phone_numbers) ? legacy.data.phone_numbers : [];
      vbPnId = legacyRows[0]?.id;
      if (legacyRows[0]) vbCfgId = 2;
    }
  } else if (vbPn.status >= 400) {
    console.error('VoBiz phone number failed:', vbPn.status, vbPn.text);
    process.exit(1);
  }
  console.log('ok  VoBiz phone number', vbPnId);

  const definition = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const wf = await http('POST', '/api/v1/workflow/create/definition', {
    name: 'VaapasAI Recovery Agent',
    workflow_definition: definition,
  }, token);
  if (wf.status >= 400) {
    console.error('Workflow create failed:', wf.status, wf.text);
    process.exit(1);
  }
  const wfId = wf.data.id;
  const wfStatus = await http('GET', `/api/v1/workflow/fetch/${wfId}`, null, token);
  if ((wfStatus.data?.status || '') !== 'active') {
    await http('POST', `/api/v1/workflow/${wfId}/publish`, {}, token);
  }
  console.log('ok  Recovery workflow active', wfId);

  const bindVl = await http('PUT', `/api/v1/organizations/telephony-configs/${vlCfgId}/phone-numbers/${vlPnId}`, {
    inbound_workflow_id: wfId,
    is_active: true,
  }, token);
  if (bindVl.status >= 400) {
    console.error('VoiceLink inbound bind failed:', bindVl.status, bindVl.text);
    process.exit(1);
  }
  console.log('ok  Inbound workflow bound to VoiceLink DID');

  const bindVb = await http('PUT', `/api/v1/organizations/telephony-configs/${vbCfgId}/phone-numbers/${vbPnId}`, {
    inbound_workflow_id: wfId,
    is_active: true,
  }, token);
  if (bindVb.status >= 400) {
    console.error('VoBiz inbound bind failed:', bindVb.status, bindVb.text);
    process.exit(1);
  }
  console.log('ok  Inbound workflow bound to VoBiz number');

  const apiKey = await http('POST', '/api/v1/user/api-keys', { name: 'Vaani AI Dashboard' }, token);
  if (apiKey.status >= 400 || !apiKey.data?.api_key) {
    console.error('API key failed:', apiKey.status, apiKey.text);
    process.exit(1);
  }
  console.log('ok  Dograh API key minted');

  const embed = await http('POST', `/api/v1/workflow/${wfId}/embed-token`, {
    allowed_domains: [
      'localhost',
      '127.0.0.1',
      'trycloudflare.com',
      new URL(tunnel).hostname,
    ],
    expires_in_days: 365,
  }, token);
  if (embed.status >= 400 || !embed.data?.token) {
    console.error('Embed token failed:', embed.status, embed.text);
    process.exit(1);
  }
  console.log('ok  Embed token minted');

  const shared = {
    DOGRAH_BASE_URL: tunnel,
    DOGRAH_API_KEY: apiKey.data.api_key,
    DOGRAH_EMBED_TOKEN: embed.data.token,
    DOGRAH_WORKFLOW_ID: String(wfId),
    DOGRAH_TELEPHONY_CONFIG_ID: String(vlCfgId),
    DOGRAH_PHONE_NUMBER_ID: String(vlPnId),
    DOGRAH_VOBIZ_TELEPHONY_CONFIG_ID: String(vbCfgId),
    DOGRAH_VOBIZ_PHONE_NUMBER_ID: String(vbPnId),
    VOICELINK_WEBSOCKET_URL: `${wsTunnel}/api/v1/telephony/ws`,
    VOICELINK_WEBHOOK_URL: `${tunnel}/api/v1/telephony/inbound/run`,
    VOBIZ_APPLICATION_ID: '',
    TELEPHONY_PROVIDER: 'voicelink',
  };
  upsertEnv(envPath, shared);
  upsertEnv(dashEnvPath, {
    ...parseEnv(dashEnvPath),
    ...shared,
    DEEPGRAM_API_KEY: env.DEEPGRAM_API_KEY,
    GROQ_API_KEY: env.GROQ_API_KEY,
    RUMIK_API_KEY: env.RUMIK_API_KEY,
    RUMIK_MODEL: env.RUMIK_MODEL || 'mulberry',
    RUMIK_VOICE: env.RUMIK_VOICE || 'ira',
    VOBIZ_AUTH_ID: env.VOBIZ_AUTH_ID,
    VOBIZ_AUTH_TOKEN: env.VOBIZ_AUTH_TOKEN,
    VOBIZ_NUMBER: env.VOBIZ_NUMBER,
    SARVAM_API_KEY: env.SARVAM_API_KEY || '',
    VOICELINK_RESELLER_USER: env.VOICELINK_RESELLER_USER,
    VOICELINK_RESELLER_PASS: env.VOICELINK_RESELLER_PASS,
    VOICELINK_DID: env.VOICELINK_DID,
    DASHBOARD_PORT: env.DASHBOARD_PORT || '8787',
  });
  console.log('\nBootstrap complete. Updated .env and dashboard/.env');
  console.log(`  DOGRAH_BASE_URL=${tunnel}`);
  console.log(`  DOGRAH_WORKFLOW_ID=${wfId}`);
  console.log(`  VoiceLink config ${vlCfgId} / phone ${vlPnId} (primary)`);
  console.log(`  VoBiz config ${vbCfgId} / phone ${vbPnId} (secondary)`);
  console.log('Restart the dashboard and Dograh API to load the new values.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
