'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const saas = require('../lib/saas');
const tx = require('../lib/call-transcripts');

test('agent capabilities surface language, style, domain, and voice tags', () => {
  const tags = tx.agentCapabilities({
    name: 'VaapasAI Recovery Agent',
    persona: 'Warm Hindi Hinglish recovery agent. Offer a payment link on WhatsApp or UPI.',
    greeting: 'Namaste',
    tts: { provider: 'rumik', voice: 'ira', model: 'mulberry' },
  });
  const ids = tags.map((row) => row.id);
  assert.ok(ids.includes('lang-hi'));
  assert.ok(ids.includes('domain-recovery'));
  assert.ok(ids.includes('int-paylink'));
  assert.ok(tags.some((row) => row.kind === 'voice' && /ira/i.test(row.label)));
});

test('restricted agents require admin while outbound dial needs operator', () => {
  const operator = { role: 'operator', status: 'active' };
  const admin = { role: 'admin', status: 'active' };
  const agent = { id: 'ag_1', restricted: true };
  assert.equal(tx.canPlaceOutbound(operator), true);
  assert.equal(tx.canSelectAgent(agent, operator), false);
  assert.equal(tx.canSelectAgent(agent, admin), true);
  assert.equal(tx.canViewTranscripts({ role: 'viewer' }), false);
  assert.equal(tx.canViewTranscripts({ role: 'analyst' }), true);
  assert.equal(tx.canSetDefaultAgent(operator), false);
  assert.equal(tx.canSetDefaultAgent(admin), true);
});

test('Dograh object logs expose realtime feedback events as turns', () => {
  const turns = tx.turnsFromLogs({
    telephony_status_callbacks: [{ event: 'call.ended', duration: 18 }],
    realtime_feedback_events: [
      { type: 'rtf-user-transcription', payload: { final: true, text: 'Hello', timestamp: '1.0' } },
      { type: 'rtf-bot-text', payload: { text: 'Hi there', timestamp: '2.0' } },
    ],
  });
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, 'customer');
  assert.equal(turns[1].role, 'agent');
});

test('Dograh logs become a timestamped verbatim transcript that is searchable', () => {
  const turns = tx.turnsFromLogs([
    { type: 'rtf-user-transcription', payload: { final: true, text: 'I will pay tomorrow', timestamp: '1.2' } },
    { type: 'rtf-bot-text', payload: { text: 'I will send the payment link.', timestamp: '2.4' } },
    { type: 'rtf-user-transcription', payload: { final: false, text: 'ignored partial' } },
  ]);
  assert.equal(turns.length, 2);
  const verbatim = tx.formatVerbatim(turns);
  assert.match(verbatim, /\[1.2\] customer: I will pay tomorrow/);
  assert.match(verbatim, /agent: I will send the payment link/);
  const row = { agentName: 'VaapasAI', destination: '+919876543210', verbatim, summary: { overview: 'Promise to pay' }, turns };
  assert.equal(tx.matchesQuery(row, 'payment link'), true);
  assert.equal(tx.matchesQuery(row, 'refund policy'), false);
  assert.equal(tx.filterTranscripts([row], { number: '98765', q: 'tomorrow' }).length, 1);
});

test('agent performance compares outbound agents and ignores demo seed', () => {
  const db = core.defaultDb();
  db.agents.push({ id: 'ag_a', tenantId: 't1', name: 'Alpha' }, { id: 'ag_b', tenantId: 't1', name: 'Beta' });
  saas.recordCallRun(db, 't1', { agentId: 'ag_a', direction: 'outbound', provider: 'voicelink', outcome: 'answered', status: 'completed', durationSec: 40, destination: '+911111111111' });
  saas.recordCallRun(db, 't1', { agentId: 'ag_b', direction: 'outbound', provider: 'voicelink', outcome: 'failed', status: 'failed', durationSec: 0, destination: '+912222222222' });
  saas.recordCallRun(db, 't1', { agentId: 'ag_a', direction: 'outbound', provider: 'voicelink', outcome: 'answered', metadata: { demoSeed: true } });
  const rows = tx.agentPerformance(db, 't1');
  assert.equal(rows.length, 2);
  const alpha = rows.find((row) => row.agentId === 'ag_a');
  const beta = rows.find((row) => row.agentId === 'ag_b');
  assert.equal(alpha.calls, 1);
  assert.equal(alpha.answerRate, 100);
  assert.equal(beta.failRate, 100);
});

test('initiate-call messages expose the Dograh run name', () => {
  const parsed = tx.parseInitiateCallMessage({ message: 'Call initiated successfully with run name WR-TEL-OUT-00000009' });
  assert.equal(parsed.workflowRunName, 'WR-TEL-OUT-00000009');
});
