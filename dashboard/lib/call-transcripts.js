'use strict';

/**
 * Outbound call transcripts: parse Dograh run logs, search, summarize,
 * agent capability tags, and post-call agent comparisons.
 */
const saas = require('./saas');

const SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'mixed']);

function emptySummary(overview) {
  return {
    overview: overview || '',
    highlights: [],
    outcomes: [],
    actionItems: [],
    sentiment: 'neutral',
  };
}

function agentCapabilities(agent) {
  const tts = (agent && agent.tts) || {};
  const blob = [agent && agent.name, agent && agent.persona, agent && agent.greeting, tts.voice, tts.description]
    .filter(Boolean).join(' ').toLowerCase();
  const tags = [];
  const add = (id, label, kind) => {
    if (!tags.some((row) => row.id === id)) tags.push({ id, label, kind });
  };

  if (/hindi|hinglish|namaste|hinglish/.test(blob)) add('lang-hi', 'Hindi / Hinglish', 'language');
  if (/\benglish\b/.test(blob)) add('lang-en', 'English', 'language');
  if (!tags.some((row) => row.kind === 'language')) add('lang-en', 'English', 'language');

  if (/witty|playful|comed|mischiev/.test(blob)) add('style-playful', 'Playful', 'style');
  else if (/warm|respect|empath/.test(blob)) add('style-warm', 'Warm', 'style');
  else add('style-direct', 'Direct', 'style');

  if (/recover|payment|emi|invoice|overdue|lender/.test(blob)) add('domain-recovery', 'Payments recovery', 'domain');
  else if (/legal|injur/.test(blob)) add('domain-legal', 'Legal intake', 'domain');
  else if (/dental|clinic/.test(blob)) add('domain-dental', 'Dental', 'domain');
  else add('domain-general', 'General assistant', 'domain');

  if (/whatsapp|sms|upi|payment link/.test(blob)) add('int-paylink', 'Payment links', 'integration');
  if (/callback|transfer|human/.test(blob)) add('int-handoff', 'Human handoff', 'integration');

  const voice = tts.provider === 'sarvam'
    ? `Sarvam ${tts.voice || tts.model || ''}`.trim()
    : `Rumik ${tts.voice || tts.speaker || tts.model || ''}`.trim();
  add('voice', voice, 'voice');

  if (agent && agent.restricted) add('access-admin', 'Admin only', 'access');
  return tags;
}

function canSelectAgent(agent, membership, user) {
  if (!agent) return false;
  if (saas.isPlatformUser(user)) return true;
  if (agent.restricted) return saas.hasOrgRole(membership, 'admin');
  return saas.hasOrgRole(membership, 'operator');
}

function canViewTranscripts(membership, user) {
  if (saas.isPlatformUser(user)) return true;
  return saas.hasOrgRole(membership, 'analyst');
}

function canPlaceOutbound(membership, user) {
  if (saas.isPlatformUser(user)) return true;
  return saas.hasOrgRole(membership, 'operator');
}

function canSetDefaultAgent(membership, user) {
  if (saas.isPlatformUser(user)) return true;
  return saas.hasOrgRole(membership, 'admin');
}

function resolveWorkflowId(agent, fallback) {
  const fromAgent = Number(agent && agent.dograhWorkflowId);
  if (Number.isInteger(fromAgent) && fromAgent > 0) return fromAgent;
  const fromEnv = Number(fallback);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return null;
}

function normalizeLogEvents(logs) {
  if (Array.isArray(logs)) return logs;
  if (logs && typeof logs === 'object' && Array.isArray(logs.realtime_feedback_events)) {
    return logs.realtime_feedback_events;
  }
  return [];
}

function turnsFromLogs(logs) {
  const turns = [];
  const events = normalizeLogEvents(logs);
  for (const event of events) {
    const type = String((event && event.type) || '');
    const payload = (event && event.payload) || {};
    const timestamp = String(payload.timestamp || event.timestamp || '');
    const endTimestamp = String(payload.end_timestamp || payload.endTimestamp || '');
    if ((type === 'rtf-user-transcription' || type.endsWith('user-transcription')) && payload.final === true) {
      const text = String(payload.text || '').trim();
      if (text) turns.push({ role: 'customer', text, timestamp, endTimestamp });
    } else if (type === 'rtf-bot-text' || type.endsWith('bot-text')) {
      const text = String(payload.text || '').trim();
      if (text) turns.push({ role: 'agent', text, timestamp, endTimestamp });
    }
  }
  return turns;
}

function formatVerbatim(turns) {
  return (turns || []).map((turn) => {
    const stamp = turn.endTimestamp && turn.timestamp
      ? `[${turn.timestamp} → ${turn.endTimestamp}] `
      : (turn.timestamp ? `[${turn.timestamp}] ` : '');
    const who = turn.role === 'agent' ? 'agent' : 'customer';
    return `${stamp}${who}: ${turn.text}`;
  }).join('\n');
}

function searchBlob(row) {
  return [
    row.agentName, row.destination, row.provider, row.verbatim,
    row.summary && row.summary.overview,
    ...(row.summary && row.summary.highlights || []),
    ...(row.summary && row.summary.outcomes || []),
    ...(row.summary && row.summary.actionItems || []),
    ...(row.turns || []).map((turn) => turn.text),
  ].filter(Boolean).join('\n').toLowerCase();
}

function matchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return searchBlob(row).includes(q);
}

function parseSummaryJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const list = (value) => (Array.isArray(value) ? value : []).map((item) => String(item).slice(0, 240)).filter(Boolean).slice(0, 8);
    const sentiment = String(parsed.sentiment || 'neutral').toLowerCase();
    return {
      overview: String(parsed.overview || parsed.summary || '').slice(0, 800),
      highlights: list(parsed.highlights || parsed.keyPoints),
      outcomes: list(parsed.outcomes),
      actionItems: list(parsed.actionItems || parsed.action_items),
      sentiment: SENTIMENTS.has(sentiment) ? sentiment : 'neutral',
    };
  } catch {
    return null;
  }
}

function heuristicSummary(verbatim) {
  const lines = String(verbatim || '').split('\n').map((line) => line.replace(/^\[[^\]]+\]\s*/, '')).filter(Boolean);
  const customer = lines.filter((line) => line.startsWith('customer:')).map((line) => line.slice(9).trim());
  const agent = lines.filter((line) => line.startsWith('agent:')).map((line) => line.slice(6).trim());
  const highlights = [...agent.slice(0, 2), ...customer.slice(0, 2)].filter(Boolean).slice(0, 4);
  return {
    overview: lines.length
      ? `Call covered ${lines.length} spoken turns. ${customer[0] ? 'Customer opened with: ' + customer[0] : 'No customer speech captured yet.'}`
      : 'No spoken turns were captured for this call.',
    highlights,
    outcomes: [],
    actionItems: [],
    sentiment: 'neutral',
  };
}

async function summarizeTranscript(llm, verbatim, agentName) {
  const text = String(verbatim || '').trim();
  if (!text) return emptySummary('No spoken turns were captured for this call.');
  if (!llm || typeof llm.chat !== 'function') return heuristicSummary(text);
  try {
    const out = await llm.chat({
      system: 'You summarize phone-call transcripts. Reply with JSON only: {"overview":string,"highlights":string[],"outcomes":string[],"actionItems":string[],"sentiment":"positive"|"neutral"|"negative"|"mixed"}. No markdown.',
      messages: [{
        role: 'user',
        text: `Agent: ${agentName || 'voice agent'}\n\nTranscript:\n${text.slice(0, 8000)}`,
      }],
    });
    return parseSummaryJson(out && out.text) || heuristicSummary(text);
  } catch {
    return heuristicSummary(text);
  }
}

function parseInitiateCallMessage(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const msg = String(payload.message || '');
  const named = msg.match(/run name\s+(WR-[A-Z0-9-]+)/i);
  const id = Number(payload.workflow_run_id || payload.workflowRunId || payload.id);
  return {
    workflowRunName: named ? named[1] : String(payload.workflow_run_name || payload.name || ''),
    workflowRunId: Number.isInteger(id) && id > 0 ? id : null,
  };
}

function publicTranscript(row, agents) {
  const agent = (agents || []).find((item) => item.id === row.agentId);
  return {
    id: row.id,
    callRunId: row.callRunId,
    agentId: row.agentId,
    agentName: row.agentName || (agent && agent.name) || 'Unknown agent',
    destination: row.destination,
    provider: row.provider,
    workflowId: row.workflowId || null,
    workflowRunId: row.workflowRunId || null,
    workflowRunName: row.workflowRunName || '',
    startedAt: row.startedAt,
    endedAt: row.endedAt || null,
    durationSec: row.durationSec || 0,
    status: row.status,
    turns: row.turns || [],
    verbatim: row.verbatim || '',
    summary: row.summary || emptySummary(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function filterTranscripts(rows, query) {
  const q = {
    search: String(query.search || query.q || '').trim(),
    agentId: String(query.agentId || '').trim(),
    destination: String(query.destination || query.number || '').replace(/\D/g, ''),
    from: String(query.from || '').slice(0, 10),
    to: String(query.to || '').slice(0, 10),
  };
  return rows.filter((row) => {
    if (q.agentId && row.agentId !== q.agentId) return false;
    if (q.destination && !String(row.destination || '').replace(/\D/g, '').includes(q.destination)) return false;
    if (q.from && String(row.startedAt || '').slice(0, 10) < q.from) return false;
    if (q.to && String(row.startedAt || '').slice(0, 10) > q.to) return false;
    return matchesQuery(row, q.search);
  });
}

function durationFromRun(run) {
  const gathered = (run && run.gathered_context) || {};
  const extra = (run && run.extra) || {};
  const logObj = run && run.logs && typeof run.logs === 'object' ? run.logs : null;
  if (logObj && Array.isArray(logObj.telephony_status_callbacks)) {
    for (let i = logObj.telephony_status_callbacks.length - 1; i >= 0; i -= 1) {
      const cb = logObj.telephony_status_callbacks[i] || {};
      const call = cb.call || {};
      const candidates = [cb.duration, call.durationSec, call.duration_sec];
      for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
    }
  }
  const candidates = [
    gathered.call_duration, gathered.duration, gathered.duration_sec,
    extra.call_duration, extra.duration_sec,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  if (run && run.created_at && run.is_completed) {
    const started = Date.parse(run.created_at);
    if (Number.isFinite(started)) return Math.max(0, Math.round((Date.now() - started) / 1000));
  }
  return 0;
}

function applyDograhRun(row, run) {
  const turns = turnsFromLogs(run && run.logs);
  const verbatim = formatVerbatim(turns);
  const completed = !!(run && (run.is_completed || turns.length));
  row.workflowRunId = Number(run && run.id) || row.workflowRunId;
  row.workflowRunName = (run && run.name) || row.workflowRunName;
  row.turns = turns;
  row.verbatim = verbatim;
  row.searchText = searchBlob(row);
  row.durationSec = durationFromRun(run) || row.durationSec || 0;
  if (completed && turns.length) row.status = 'ready';
  else if (run && run.is_completed && !turns.length) row.status = 'unavailable';
  else row.status = 'pending';
  row.updatedAt = new Date().toISOString();
  if (run && run.is_completed) row.endedAt = new Date().toISOString();
  return row;
}

function agentPerformance(d, tenantId) {
  const runs = (d.callRuns || []).filter((row) => (
    row.tenantId === tenantId
    && row.direction === 'outbound'
    && !(row.metadata && row.metadata.demoSeed)
  ));
  const transcripts = (d.callTranscripts || []).filter((row) => row.tenantId === tenantId);
  const byAgent = new Map();
  for (const run of runs) {
    const key = run.agentId || 'unassigned';
    const bucket = byAgent.get(key) || {
      agentId: run.agentId || null,
      calls: 0,
      answered: 0,
      failed: 0,
      durationSec: 0,
      sentiments: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    };
    bucket.calls += 1;
    if (run.outcome === 'answered' || run.outcome === 'completed') bucket.answered += 1;
    if (run.outcome === 'failed' || run.status === 'failed') bucket.failed += 1;
    bucket.durationSec += Number(run.durationSec || 0);
    const tx = transcripts.find((row) => row.callRunId === run.id);
    const sentiment = tx && tx.summary && tx.summary.sentiment;
    if (SENTIMENTS.has(sentiment)) bucket.sentiments[sentiment] += 1;
    byAgent.set(key, bucket);
  }

  const agents = d.agents || [];
  return Array.from(byAgent.values()).map((bucket) => {
    const agent = agents.find((item) => item.id === bucket.agentId);
    return {
      agentId: bucket.agentId,
      agentName: (agent && agent.name) || (bucket.agentId ? 'Deleted agent' : 'Unassigned'),
      calls: bucket.calls,
      answerRate: bucket.calls ? Math.round((bucket.answered / bucket.calls) * 1000) / 10 : 0,
      failRate: bucket.calls ? Math.round((bucket.failed / bucket.calls) * 1000) / 10 : 0,
      avgDurationSec: bucket.calls ? Math.round(bucket.durationSec / bucket.calls) : 0,
      sentiments: bucket.sentiments,
    };
  }).sort((a, b) => b.calls - a.calls);
}

module.exports = {
  emptySummary,
  agentCapabilities,
  canSelectAgent,
  canViewTranscripts,
  canPlaceOutbound,
  canSetDefaultAgent,
  resolveWorkflowId,
  normalizeLogEvents,
  turnsFromLogs,
  formatVerbatim,
  matchesQuery,
  parseSummaryJson,
  heuristicSummary,
  summarizeTranscript,
  parseInitiateCallMessage,
  publicTranscript,
  filterTranscripts,
  applyDograhRun,
  agentPerformance,
  searchBlob,
};
