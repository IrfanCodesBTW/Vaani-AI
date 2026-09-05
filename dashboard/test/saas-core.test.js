'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const saas = require('../lib/saas');

test('schema migration is additive and normalizes roles', () => {
  const old = { tenants: [{ id: 't1' }], users: [{ id: 'u1', role: 'unknown' }], agents: [{ id: 'a1' }] };
  const migrated = core.migrateDb(old);
  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.agents.length, 1);
  assert.equal(migrated.users[0].role, 'member');
  assert.equal(migrated.tenants[0].status, 'active');
  assert.equal(migrated.tenants[0].privacyMode, 'standard');
  assert.equal(migrated.tenants[0].defaultOutboundAgentId, null);
  for (const key of ['wallets', 'ledger', 'paymentIntents', 'paymentEvents', 'supportTickets', 'supportMessages', 'auditEvents', 'presets', 'byonConnections', 'hvacJobs', 'hvacSettings', 'demoLinks', 'invoices', 'invoiceEvents', 'integrationRequests', 'agencyPrompts', 'clientActivities', 'tenantStatusEvents', 'memberships', 'invitations', 'providerCredentials', 'callRuns', 'campaigns', 'callTranscripts']) assert.ok(Array.isArray(migrated[key]));
  assert.equal(migrated.memberships.length, 0);
});

test('credential encryption round trips and masks suffixes', () => {
  const encrypted = saas.encryptSecret('sk-live-abcdef123456');
  assert.notEqual(encrypted, 'sk-live-abcdef123456');
  assert.equal(saas.decryptSecret(encrypted), 'sk-live-abcdef123456');
  assert.equal(saas.maskSuffix('sk-live-abcdef123456'), '****3456');
});

test('voice overview stays tenant scoped and demo seed is isolated', () => {
  const db = core.defaultDb();
  db.tenants.push({ id: 't1', name: 'A', slug: 'a', status: 'active', privacyMode: 'standard', parent_account_id: null, createdAt: new Date().toISOString() });
  db.tenants.push({ id: 't2', name: 'B', slug: 'b', status: 'active', privacyMode: 'standard', parent_account_id: null, createdAt: new Date().toISOString() });
  saas.seedDemoVoiceData(db, 't1');
  const alpha = saas.buildVoiceOverview(db, 't1', {});
  const beta = saas.buildVoiceOverview(db, 't2', {});
  assert.ok(alpha.kpis.calls > 0);
  assert.equal(beta.empty, true);
});

test('password hashes verify and role hierarchy is enforced', () => {
  const hash = core.hashPassword('a safe password');
  assert.equal(core.verifyPassword('a safe password', hash), true);
  assert.equal(core.verifyPassword('wrong', hash), false);
  assert.equal(core.hasRole({ role: 'super_admin' }, 'admin'), true);
  assert.equal(core.hasRole({ role: 'owner' }, 'admin'), false);
  assert.equal(core.hasRole({ role: 'member' }, 'member'), true);
});
