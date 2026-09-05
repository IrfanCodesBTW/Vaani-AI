'use strict';

/**
 * Workspace credential resolution: encrypted tenant keys in db.json with .env fallback.
 */
const { AsyncLocalStorage } = require('async_hooks');
const core = require('./core');
const saas = require('./saas');

const requestContext = new AsyncLocalStorage();

const CATALOG = Object.freeze([
  {
    id: 'rumik-tts',
    provider: 'rumik',
    layer: 'tts',
    label: 'Rumik Silk',
    description: 'Text-to-speech. Mulberry and Muga models.',
    fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }],
    envKeys: ['RUMIK_API_KEY'],
  },
  {
    id: 'deepgram-stt',
    provider: 'deepgram',
    layer: 'stt',
    label: 'Deepgram',
    description: 'Speech-to-text. Nova-3 multilingual.',
    fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }],
    envKeys: ['DEEPGRAM_API_KEY'],
  },
  {
    id: 'groq-llm',
    provider: 'groq',
    layer: 'llm',
    label: 'Groq',
    description: 'LLM brain. GPT-OSS 120B primary, 20B fallback.',
    fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }],
    envKeys: ['GROQ_API_KEY'],
  },
  {
    id: 'gemini-llm',
    provider: 'gemini',
    layer: 'llm',
    label: 'Google Gemini',
    description: 'Optional LLM alternative to Groq.',
    fields: [{ name: 'apiKey', label: 'API key', type: 'password', required: true }],
    envKeys: ['GEMINI_API_KEY'],
  },
  {
    id: 'sarvam-all',
    provider: 'sarvam',
    layer: 'stt',
    layers: ['stt', 'tts', 'llm'],
    label: 'Sarvam AI',
    description: 'One API key enables Sarvam STT, TTS, and LLM independently in the pipeline.',
    fields: [{ name: 'apiKey', label: 'API subscription key', type: 'password', required: true }],
    envKeys: ['SARVAM_API_KEY'],
  },
  {
    id: 'dograh-vobiz',
    provider: 'dograh',
    layer: 'telephony',
    telephonyCarrier: 'vobiz',
    label: 'VoBiz via Dograh',
    description: 'Secondary telephony. Dograh orchestrates VoBiz calls.',
    fields: [
      { name: 'baseUrl', label: 'Dograh base URL', type: 'text', required: true, placeholder: 'https://your-host.example.com' },
      { name: 'apiKey', label: 'Dograh organization API key', type: 'password', required: true },
      { name: 'workflowId', label: 'Workflow ID', type: 'text', required: true },
      { name: 'vobizTelephonyConfigId', label: 'VoBiz telephony config ID', type: 'text', required: true },
      { name: 'vobizPhoneNumberId', label: 'VoBiz phone number ID', type: 'text', required: true },
      { name: 'vobizNumber', label: 'VoBiz number (display)', type: 'text', required: false, placeholder: '91XXXXXXXXXX' },
    ],
    envKeys: ['DOGRAH_BASE_URL', 'DOGRAH_API_KEY', 'DOGRAH_WORKFLOW_ID', 'DOGRAH_VOBIZ_TELEPHONY_CONFIG_ID', 'DOGRAH_VOBIZ_PHONE_NUMBER_ID'],
  },
  {
    id: 'dograh-voicelink',
    provider: 'dograh',
    layer: 'telephony',
    telephonyCarrier: 'voicelink',
    label: 'VoiceLink via Dograh',
    description: 'Primary telephony. Dograh orchestrates VoiceLink calls.',
    fields: [
      { name: 'baseUrl', label: 'Dograh base URL', type: 'text', required: true, placeholder: 'https://your-host.example.com' },
      { name: 'apiKey', label: 'Dograh organization API key', type: 'password', required: true },
      { name: 'workflowId', label: 'Workflow ID', type: 'text', required: true },
      { name: 'telephonyConfigId', label: 'VoiceLink telephony config ID', type: 'text', required: true },
      { name: 'phoneNumberId', label: 'VoiceLink phone number ID', type: 'text', required: true },
    ],
    envKeys: ['DOGRAH_BASE_URL', 'DOGRAH_API_KEY', 'DOGRAH_WORKFLOW_ID', 'DOGRAH_TELEPHONY_CONFIG_ID', 'DOGRAH_PHONE_NUMBER_ID'],
  },
  {
    id: 'voicelink-tel',
    provider: 'voicelink',
    layer: 'telephony',
    telephonyCarrier: 'voicelink',
    label: 'VoiceLink reseller login',
    description: 'VoiceLink reseller credentials used by Dograh telephony config.',
    fields: [
      { name: 'user', label: 'Reseller email', type: 'text', required: true },
      { name: 'password', label: 'Reseller password', type: 'password', required: true },
      { name: 'did', label: 'DID (E.164)', type: 'text', required: true, placeholder: '91XXXXXXXXXX' },
      { name: 'baseUrl', label: 'API base (optional)', type: 'text', required: false, placeholder: 'https://app.voicelink.co.in/api' },
    ],
    envKeys: ['VOICELINK_RESELLER_USER', 'VOICELINK_RESELLER_PASS', 'VOICELINK_DID'],
  },
]);

function runWithTenant(tenantId, fn) {
  return requestContext.run({ tenantId: tenantId || null }, fn);
}

function activeTenantId(explicit) {
  if (explicit) return explicit;
  const store = requestContext.getStore();
  return store && store.tenantId ? store.tenantId : null;
}

function findCredentialRow(orgId, provider, layer) {
  if (!orgId) return null;
  return core.db().providerCredentials.find((row) =>
    row.organizationId === orgId && row.provider === provider && row.layer === layer);
}

function decryptRow(row) {
  if (!row) return null;
  const plain = saas.decryptSecret(row.encryptedSecret);
  try {
    const parsed = JSON.parse(plain);
    return typeof parsed === 'object' && parsed !== null ? parsed : plain;
  } catch (_) {
    return plain;
  }
}

function envValue(key) {
  const v = String(process.env[key] || '').trim();
  if (!v || v.includes('your_') || v.includes('XXXXXXXX')) return '';
  return v;
}

function resolveSecret(orgId, provider, layer, envKeys = []) {
  const oid = activeTenantId(orgId);
  if (oid) {
    let row = findCredentialRow(oid, provider, layer);
    if (!row && provider === 'sarvam') {
      for (const l of ['stt', 'tts', 'llm']) {
        row = findCredentialRow(oid, 'sarvam', l);
        if (row) break;
      }
    }
    if (!row && provider === 'dograh' && layer === 'telephony') {
      row = findCredentialRow(oid, 'dograh', 'telephony');
    }
    if (row) {
      const val = decryptRow(row);
      if (typeof val === 'string' && val) return val;
      if (val && typeof val === 'object' && val.apiKey) return val.apiKey;
      if (val && typeof val === 'object') return val;
    }
  }
  for (const key of envKeys) {
    const v = envValue(key);
    if (v) return v;
  }
  return null;
}

function resolveObject(orgId, provider, layer, envMap) {
  const oid = activeTenantId(orgId);
  if (oid) {
    const row = findCredentialRow(oid, provider, layer);
    if (row) {
      const val = decryptRow(row);
      if (val && typeof val === 'object') return val;
      if (typeof val === 'string' && val) return { apiKey: val };
    }
  }
  const out = {};
  for (const [field, envKey] of Object.entries(envMap)) {
    const v = envValue(envKey);
    if (v) out[field] = v;
  }
  return Object.keys(out).length ? out : null;
}

function resolveDograhConfig(orgId) {
  const fromDb = resolveObject(orgId, 'dograh', 'telephony', {
    baseUrl: 'DOGRAH_BASE_URL',
    apiKey: 'DOGRAH_API_KEY',
    workflowId: 'DOGRAH_WORKFLOW_ID',
    telephonyConfigId: 'DOGRAH_TELEPHONY_CONFIG_ID',
    phoneNumberId: 'DOGRAH_PHONE_NUMBER_ID',
    vobizTelephonyConfigId: 'DOGRAH_VOBIZ_TELEPHONY_CONFIG_ID',
    vobizPhoneNumberId: 'DOGRAH_VOBIZ_PHONE_NUMBER_ID',
    vobizNumber: 'VOBIZ_NUMBER',
  }) || {};
  return {
    baseUrl: fromDb.baseUrl || envValue('DOGRAH_BASE_URL'),
    apiKey: fromDb.apiKey || envValue('DOGRAH_API_KEY'),
    workflowId: fromDb.workflowId || envValue('DOGRAH_WORKFLOW_ID'),
    telephonyConfigId: fromDb.telephonyConfigId || envValue('DOGRAH_TELEPHONY_CONFIG_ID'),
    phoneNumberId: fromDb.phoneNumberId || envValue('DOGRAH_PHONE_NUMBER_ID'),
    vobizTelephonyConfigId: fromDb.vobizTelephonyConfigId || envValue('DOGRAH_VOBIZ_TELEPHONY_CONFIG_ID'),
    vobizPhoneNumberId: fromDb.vobizPhoneNumberId || envValue('DOGRAH_VOBIZ_PHONE_NUMBER_ID'),
    vobizNumber: fromDb.vobizNumber || envValue('VOBIZ_NUMBER'),
    live: !!(fromDb.baseUrl || envValue('DOGRAH_BASE_URL'))
      && !!(fromDb.apiKey || envValue('DOGRAH_API_KEY'))
      && !!(fromDb.workflowId || envValue('DOGRAH_WORKFLOW_ID'))
      && !!(fromDb.telephonyConfigId || envValue('DOGRAH_TELEPHONY_CONFIG_ID'))
      && !!(fromDb.phoneNumberId || envValue('DOGRAH_PHONE_NUMBER_ID')),
  };
}

function resolveVoicelinkConfig(orgId) {
  const fromDb = resolveObject(orgId, 'voicelink', 'telephony', {
    user: 'VOICELINK_RESELLER_USER',
    password: 'VOICELINK_RESELLER_PASS',
    did: 'VOICELINK_DID',
    baseUrl: 'VOICELINK_BASE',
  }) || {};
  const password = fromDb.password || envValue('VOICELINK_RESELLER_PASS') || envValue('VOICELINK_RESELLER_PASSWORD');
  return {
    user: fromDb.user || envValue('VOICELINK_RESELLER_USER'),
    password,
    did: fromDb.did || envValue('VOICELINK_DID'),
    baseUrl: fromDb.baseUrl || envValue('VOICELINK_BASE') || 'https://app.voicelink.co.in/api',
    live: !!(fromDb.user || envValue('VOICELINK_RESELLER_USER')) && !!password && !!(fromDb.did || envValue('VOICELINK_DID')),
  };
}

function isAdapterLive(adapter, orgId) {
  const id = adapter.id;
  if (id === 'vobiz' || id === 'dograh') return resolveDograhConfig(orgId).live;
  if (id === 'voicelink') return resolveVoicelinkConfig(orgId).live;
  if (id === 'sarvam') {
    return !!resolveSecret(orgId, 'sarvam', 'stt', adapter.needs || ['SARVAM_API_KEY']);
  }
  const keys = adapter.needs || [];
  return !!resolveSecret(orgId, id, adapter.layer, keys);
}

function publicCatalog() {
  return CATALOG.map((item) => ({
    id: item.id,
    provider: item.provider,
    layer: item.layer,
    layers: item.layers || [item.layer],
    label: item.label,
    description: item.description,
    fields: item.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: !!f.required, placeholder: f.placeholder || '' })),
    telephonyCarrier: item.telephonyCarrier || null,
  }));
}

function catalogEntry(catalogId) {
  return CATALOG.find((item) => item.id === catalogId) || null;
}

function buildSecretFromPayload(entry, body) {
  const fields = entry.fields || [];
  if (fields.length === 1 && fields[0].name === 'apiKey') {
    return String(body.apiKey || body.secret || '').trim();
  }
  const out = {};
  for (const field of fields) {
    const val = String(body[field.name] || '').trim();
    if (field.required && !val) throw new Error(`${field.label} is required`);
    if (val) out[field.name] = val;
  }
  if (!Object.keys(out).length) throw new Error('credential fields required');
  return JSON.stringify(out);
}

function credentialStatus(orgId) {
  const rows = core.db().providerCredentials.filter((row) => row.organizationId === orgId);
  return CATALOG.map((item) => {
    const layers = item.layers || [item.layer];
    const matches = rows.filter((row) => row.provider === item.provider && layers.includes(row.layer));
    const configured = matches.length > 0;
    return {
      catalogId: item.id,
      provider: item.provider,
      layer: item.layer,
      label: item.label,
      configured,
      maskedSuffix: configured ? matches[0].maskedSuffix : null,
      updatedAt: configured ? matches[0].updatedAt : null,
      source: configured ? 'workspace' : (isAdapterLive({ id: item.provider, layer: item.layer, needs: item.envKeys }, null) ? 'server_env' : 'missing'),
    };
  });
}

module.exports = {
  CATALOG,
  runWithTenant,
  activeTenantId,
  resolveSecret,
  resolveObject,
  resolveDograhConfig,
  resolveVoicelinkConfig,
  isAdapterLive,
  publicCatalog,
  catalogEntry,
  buildSecretFromPayload,
  credentialStatus,
};
