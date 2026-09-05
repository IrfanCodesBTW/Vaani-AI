'use strict';

/**
 * Multi-tenant SaaS primitives: memberships, invitations, credential encryption,
 * org role checks, and voice analytics aggregation.
 */
const crypto = require('crypto');
const core = require('./core');

const ORG_ROLES = Object.freeze(['viewer', 'analyst', 'operator', 'admin', 'owner']);
const ORG_ROLE_LEVEL = Object.freeze({ viewer: 1, analyst: 2, operator: 3, admin: 4, owner: 5 });
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_OUTCOMES = Object.freeze(['answered', 'completed', 'voicemail', 'busy', 'no_answer', 'failed', 'abandoned']);

function isPlatformUser(user) {
  return !!user && (user.role === 'super_admin' || user.role === 'admin');
}

function mapLegacyUserRole(role) {
  if (role === 'owner') return 'owner';
  if (role === 'admin') return 'admin';
  return 'operator';
}

function credentialKey() {
  const raw = String(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'vaani-local-dev-key-change-me').slice(0, 64);
  return crypto.scryptSync(raw, 'vaani-credentials', 32);
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'gcm') throw new Error('invalid encrypted credential');
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const data = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function maskSuffix(value) {
  const text = String(value || '');
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}

function publicOrganization(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    parentAccountId: tenant.parent_account_id || null,
    branding: tenant.branding,
    providers: tenant.providers,
    plan: tenant.plan,
    status: tenant.status,
    privacyMode: tenant.privacyMode,
    defaultOutboundAgentId: tenant.defaultOutboundAgentId || null,
    createdAt: tenant.createdAt,
  };
}

function publicMembership(membership, tenant) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    organization: tenant ? publicOrganization(tenant) : undefined,
    createdAt: membership.createdAt,
  };
}

function publicCredential(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    layer: row.layer,
    label: row.label || '',
    maskedSuffix: row.maskedSuffix,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function publicInvitation(invite) {
  return {
    id: invite.id,
    organizationId: invite.organizationId,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt || null,
    revokedAt: invite.revokedAt || null,
    createdAt: invite.createdAt,
    invitedByUserId: invite.invitedByUserId,
  };
}

function findMembership(d, userId, organizationId) {
  return d.memberships.find((row) => row.userId === userId && row.organizationId === organizationId && row.status === 'active');
}

function listOrganizationsForUser(d, user) {
  const memberships = d.memberships.filter((row) => row.userId === user.id && row.status === 'active');
  return memberships.map((membership) => {
    const tenant = d.tenants.find((row) => row.id === membership.organizationId);
    return tenant ? publicMembership(membership, tenant) : null;
  }).filter(Boolean);
}

function hasOrgRole(membership, minimum) {
  if (!membership) return false;
  return (ORG_ROLE_LEVEL[membership.role] || 0) >= (ORG_ROLE_LEVEL[minimum] || 99);
}

function resolveMembership(d, user, organizationId) {
  if (isPlatformUser(user)) {
    const tenant = d.tenants.find((row) => row.id === organizationId);
    if (!tenant) return null;
    return { id: `platform:${user.id}:${organizationId}`, organizationId, userId: user.id, role: 'owner', status: 'active' };
  }
  return findMembership(d, user.id, organizationId);
}

function ensureMembership(d, userId, organizationId, role = 'owner') {
  let membership = findMembership(d, userId, organizationId);
  if (membership) return membership;
  membership = {
    id: core.genId('mem_'),
    organizationId,
    userId,
    role: ORG_ROLES.includes(role) ? role : 'viewer',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  d.memberships.push(membership);
  return membership;
}

function migrateTenantMemberships(d) {
  for (const user of d.users) {
    if (!user.tenantId) continue;
    ensureMembership(d, user.id, user.tenantId, mapLegacyUserRole(user.role));
  }
  for (const tenant of d.tenants) {
    if (tenant.parent_account_id === undefined) tenant.parent_account_id = null;
  }
}

function addInvitationAudit(invite, action, actorUserId, metadata = {}) {
  invite.auditTrail = invite.auditTrail || [];
  invite.auditTrail.push({ action, actorUserId, metadata, createdAt: new Date().toISOString() });
}

function createInvitation(d, ctx, email, role) {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const invite = {
    id: core.genId('inv_'),
    organizationId: ctx.tenant.id,
    email: String(email).trim().toLowerCase(),
    role: ORG_ROLES.includes(role) ? role : 'viewer',
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    usedAt: null,
    usedByUserId: null,
    revokedAt: null,
    invitedByUserId: ctx.user.id,
    createdAt: now,
    auditTrail: [],
  };
  addInvitationAudit(invite, 'invitation.created', ctx.user.id, { role: invite.role });
  d.invitations.push(invite);
  return { invite, token };
}

function acceptInvitation(d, token, user) {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const invite = d.invitations.find((row) => row.tokenHash === tokenHash);
  if (!invite || invite.revokedAt) return { error: 'invitation not found', code: 'not_found' };
  if (invite.usedAt) return { error: 'invitation already used', code: 'invite_used' };
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return { error: 'invitation expired', code: 'invite_expired' };
  if (String(user.email).toLowerCase() !== invite.email) return { error: 'invitation email mismatch', code: 'invite_email_mismatch' };
  const membership = ensureMembership(d, user.id, invite.organizationId, invite.role);
  invite.usedAt = new Date().toISOString();
  invite.usedByUserId = user.id;
  addInvitationAudit(invite, 'invitation.accepted', user.id, { membershipId: membership.id });
  return { invite, membership };
}

function upsertCredential(d, ctx, payload) {
  const provider = String(payload.provider || '').toLowerCase().slice(0, 40);
  const layer = String(payload.layer || '').toLowerCase();
  const secret = String(payload.secret || '');
  const label = String(payload.label || '').slice(0, 80);
  const idempotencyKey = String(payload.idempotencyKey || '').trim().slice(0, 120);
  if (!provider || !['stt', 'tts', 'llm', 'telephony'].includes(layer)) throw new Error('invalid credential payload');
  if (!secret || secret.length < 4) throw new Error('credential secret required');
  if (idempotencyKey) {
    const duplicate = d.providerCredentials.find((row) => row.organizationId === ctx.tenant.id && row.idempotencyKey === idempotencyKey);
    if (duplicate) return duplicate;
  }
  const now = new Date().toISOString();
  let row = d.providerCredentials.find((item) => item.organizationId === ctx.tenant.id && item.provider === provider && item.layer === layer);
  if (!row) {
    row = {
      id: core.genId('cred_'),
      organizationId: ctx.tenant.id,
      provider,
      layer,
      label,
      encryptedSecret: encryptSecret(secret),
      maskedSuffix: maskSuffix(secret),
      idempotencyKey: idempotencyKey || core.genId('idem_'),
      createdBy: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    };
    d.providerCredentials.push(row);
  } else {
    row.encryptedSecret = encryptSecret(secret);
    row.maskedSuffix = maskSuffix(secret);
    row.label = label;
    row.updatedAt = now;
  }
  return row;
}

function recordCallRun(d, tenantId, payload) {
  const now = new Date().toISOString();
  const run = {
    id: core.genId('run_'),
    tenantId,
    agentId: payload.agentId || null,
    campaignId: payload.campaignId || null,
    direction: ['inbound', 'outbound'].includes(payload.direction) ? payload.direction : 'outbound',
    provider: String(payload.provider || 'unknown').slice(0, 40),
    status: String(payload.status || 'completed').slice(0, 40),
    outcome: CALL_OUTCOMES.includes(payload.outcome) ? payload.outcome : 'completed',
    durationSec: Math.max(0, Number(payload.durationSec || 0)),
    aiSpendPaise: Math.max(0, Number(payload.aiSpendPaise || 0)),
    destination: String(payload.destination || '').replace(/[^\d+]/g, '').slice(0, 16),
    workflowId: payload.workflowId || null,
    workflowRunId: payload.workflowRunId || null,
    workflowRunName: String(payload.workflowRunName || '').slice(0, 80),
    startedAt: payload.startedAt || now,
    endedAt: payload.endedAt || now,
    metadata: payload.metadata || {},
  };
  d.callRuns.push(run);
  return run;
}

function seedDemoVoiceData(d, tenantId) {
  if (d.callRuns.some((row) => row.tenantId === tenantId && row.metadata && row.metadata.demoSeed)) return false;
  const agents = d.agents.filter((row) => row.tenantId === tenantId);
  const agentId = agents[0] ? agents[0].id : null;
  let campaign = d.campaigns.find((row) => row.tenantId === tenantId && row.name === 'Demo outreach');
  if (!campaign) {
    campaign = { id: core.genId('cmp_'), tenantId, name: 'Demo outreach', status: 'draft', createdAt: new Date().toISOString() };
    d.campaigns.push(campaign);
  }
  const providers = ['vobiz', 'webrtc'];
  const directions = ['inbound', 'outbound'];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const count = 2 + (i % 4);
    for (let j = 0; j < count; j++) {
      const answered = j % 3 !== 0;
      const durationSec = answered ? 45 + ((i + j) % 6) * 20 : 0;
      recordCallRun(d, tenantId, {
        agentId,
        campaignId: j % 2 === 0 ? campaign.id : null,
        direction: directions[j % directions.length],
        provider: providers[j % providers.length],
        status: answered ? 'completed' : 'missed',
        outcome: answered ? 'answered' : 'no_answer',
        durationSec,
        aiSpendPaise: answered ? 70 + ((i + j) % 5) * 12 : 0,
        startedAt: new Date(day.getTime() + j * 3600000).toISOString(),
        endedAt: new Date(day.getTime() + j * 3600000 + durationSec * 1000).toISOString(),
        metadata: { demoSeed: true },
      });
    }
  }
  return true;
}

function parseVoiceFilters(url) {
  const q = new URL(url, 'http://localhost').searchParams;
  return {
    from: String(q.get('from') || '').slice(0, 10),
    to: String(q.get('to') || '').slice(0, 10),
    agentId: String(q.get('agentId') || '').trim(),
    campaignId: String(q.get('campaignId') || '').trim(),
    provider: String(q.get('provider') || '').trim().toLowerCase(),
    direction: String(q.get('direction') || '').trim().toLowerCase(),
    demo: q.get('demo') === 'true',
  };
}

function inDateRange(iso, from, to) {
  const day = String(iso || '').slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function buildVoiceOverview(d, tenantId, filters) {
  let runs = d.callRuns.filter((row) => row.tenantId === tenantId);
  if (filters.agentId) runs = runs.filter((row) => row.agentId === filters.agentId);
  if (filters.campaignId) runs = runs.filter((row) => row.campaignId === filters.campaignId);
  if (filters.provider) runs = runs.filter((row) => row.provider === filters.provider);
  if (filters.direction) runs = runs.filter((row) => row.direction === filters.direction);
  if (filters.from || filters.to) runs = runs.filter((row) => inDateRange(row.startedAt, filters.from, filters.to));

  const answered = runs.filter((row) => row.outcome === 'answered' || row.outcome === 'completed');
  const totalCalls = runs.length;
  const answeredRate = totalCalls ? Math.round((answered.length / totalCalls) * 1000) / 10 : 0;
  const durationSec = runs.reduce((sum, row) => sum + Number(row.durationSec || 0), 0);
  const aiSpendPaise = runs.reduce((sum, row) => sum + Number(row.aiSpendPaise || 0), 0);
  const campaigns = new Set(runs.map((row) => row.campaignId).filter(Boolean));

  const dayMap = new Map();
  for (const row of runs) {
    const date = String(row.startedAt).slice(0, 10);
    const bucket = dayMap.get(date) || { date, calls: 0, answered: 0, durationSec: 0, aiSpendPaise: 0 };
    bucket.calls += 1;
    if (row.outcome === 'answered' || row.outcome === 'completed') bucket.answered += 1;
    bucket.durationSec += Number(row.durationSec || 0);
    bucket.aiSpendPaise += Number(row.aiSpendPaise || 0);
    dayMap.set(date, bucket);
  }
  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const outcomeMap = new Map();
  for (const row of runs) {
    const key = row.outcome || 'unknown';
    outcomeMap.set(key, (outcomeMap.get(key) || 0) + 1);
  }
  const outcomes = Array.from(outcomeMap.entries()).map(([outcome, count]) => ({ outcome, count }));

  const providerMap = new Map();
  for (const row of runs) providerMap.set(row.provider, (providerMap.get(row.provider) || 0) + 1);
  const providers = Array.from(providerMap.entries()).map(([provider, count]) => ({ provider, count }));

  const funnel = [
    { stage: 'Dialed', count: totalCalls },
    { stage: 'Connected', count: answered.length },
    { stage: 'Completed', count: runs.filter((row) => row.status === 'completed').length },
    { stage: 'Qualified', count: runs.filter((row) => row.outcome === 'completed').length },
  ];

  const campaignRows = d.campaigns.filter((row) => row.tenantId === tenantId).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    calls: runs.filter((run) => run.campaignId === row.id).length,
  }));

  return {
    dataMode: runs.some((row) => row.metadata && row.metadata.demoSeed) ? 'demo_seed' : 'live',
    asOf: new Date().toISOString(),
    filters,
    kpis: {
      calls: totalCalls,
      answeredRate,
      outcomes: outcomes.length,
      durationSec,
      aiSpendPaise,
      campaigns: campaigns.size,
    },
    days,
    outcomes,
    providers,
    funnel,
    campaigns: campaignRows,
    spendSeries: days.map((row) => ({ date: row.date, aiSpendPaise: row.aiSpendPaise })),
    empty: totalCalls === 0,
  };
}

function voiceFilterOptions(d, tenantId) {
  const runs = d.callRuns.filter((row) => row.tenantId === tenantId);
  const agents = d.agents.filter((row) => row.tenantId === tenantId).map((row) => ({ id: row.id, name: row.name }));
  const campaigns = d.campaigns.filter((row) => row.tenantId === tenantId).map((row) => ({ id: row.id, name: row.name, status: row.status }));
  const providers = Array.from(new Set(runs.map((row) => row.provider))).sort();
  const directions = ['inbound', 'outbound'];
  return { agents, campaigns, providers, directions };
}

async function switchOrganization(req, user, organizationId) {
  const d = core.db();
  const tenant = d.tenants.find((row) => row.id === organizationId && row.status === 'active');
  if (!tenant) return { error: 'organization not found', code: 'not_found', status: 404 };
  const membership = resolveMembership(d, user, organizationId);
  if (!membership) return { error: 'membership required', code: 'forbidden', status: 403 };
  const token = core.parseCookieToken(req);
  if (!token) return { error: 'authentication required', code: 'no_session', status: 401 };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await core.mutate((store) => {
    const session = store.sessions.find((row) => row.tokenHash === tokenHash || row.token === token);
    if (session) session.tenantId = organizationId;
  });
  return { tenant, membership };
}

function requireOrgRole(minimum) {
  return (req, res, handler, body) => core.requireAuth(req, res, (request, response, ctx) => {
    const membership = resolveMembership(core.db(), ctx.user, ctx.tenant.id);
    if (!membership || !hasOrgRole(membership, minimum)) {
      return core.sendJson(response, 403, { error: 'insufficient organization role', code: 'forbidden' });
    }
    return handler(request, response, { ...ctx, membership, body });
  }, body);
}

module.exports = {
  ORG_ROLES,
  ORG_ROLE_LEVEL,
  isPlatformUser,
  encryptSecret,
  decryptSecret,
  maskSuffix,
  publicOrganization,
  publicMembership,
  publicCredential,
  publicInvitation,
  findMembership,
  listOrganizationsForUser,
  hasOrgRole,
  resolveMembership,
  ensureMembership,
  migrateTenantMemberships,
  addInvitationAudit,
  createInvitation,
  acceptInvitation,
  upsertCredential,
  recordCallRun,
  seedDemoVoiceData,
  parseVoiceFilters,
  buildVoiceOverview,
  voiceFilterOptions,
  switchOrganization,
  requireOrgRole,
};
