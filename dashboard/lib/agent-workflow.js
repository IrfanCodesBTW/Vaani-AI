'use strict';

/**
 * Push a dashboard agent's persona, greeting, and voice instructions into a
 * Dograh workflow so outbound (and inbound) calls actually speak as that agent.
 */
const providers = require('./providers');

function node(id, type, x, y, data) {
  return {
    id: String(id),
    type,
    position: { x, y },
    data,
    measured: { width: 320, height: 128 },
    selected: false,
    dragging: false,
  };
}

function edge(source, target, label, condition) {
  return {
    id: `${source}-${target}`,
    source: String(source),
    target: String(target),
    type: 'custom',
    animated: true,
    data: { label, condition },
  };
}

function spokenPersona(agent) {
  const name = String((agent && agent.name) || 'the voice agent').trim();
  const persona = String((agent && agent.persona) || '').trim();
  const greeting = String((agent && agent.greeting) || '').trim();
  const tts = (agent && agent.tts) || {};
  const voiceLine = tts.provider === 'sarvam'
    ? `Voice: Sarvam ${tts.voice || tts.model || ''}`.trim()
    : `Voice: Rumik ${tts.voice || tts.speaker || tts.model || ''}`.trim();
  const parts = [
    `You are ${name}, a live phone voice agent.`,
    persona || `Stay in character as ${name}.`,
    'Speak only in short spoken sentences, one or two per turn. No markdown, lists, or stage directions.',
    'Never say you are a customer service bot, a call center, or a generic assistant unless that is this persona.',
    'Never invent facts, prices, policies, or personal data.',
    voiceLine,
  ];
  if (greeting) parts.push(`Your opening line on this call must match this greeting: ${greeting}`);
  return parts.join('\n');
}

function isRecoveryAgent(agent) {
  const blob = [agent && agent.name, agent && agent.persona].filter(Boolean).join(' ').toLowerCase();
  return /recover|payment|emi|invoice|overdue|vaapas/.test(blob);
}

function conversationDefinition(agent) {
  const name = String((agent && agent.name) || 'Voice Agent').trim();
  const greeting = String((agent && agent.greeting) || `Hi, this is ${name}.`).trim();
  return {
    nodes: [
      node(0, 'globalNode', -380, 260, {
        name: `${name} Global`,
        allow_interrupt: true,
        prompt: spokenPersona(agent),
      }),
      node(1, 'startCall', 120, 40, {
        name: 'Greeting',
        allow_interrupt: true,
        add_global_prompt: true,
        delayed_start: false,
        is_start: true,
        greeting_type: 'text',
        greeting,
        prompt: `Speak the greeting as ${name}, then continue in this exact persona. Do not replace the greeting with a generic customer-service welcome.`,
      }),
      node(2, 'agentNode', 120, 280, {
        name: 'Stay in character',
        allow_interrupt: true,
        add_global_prompt: true,
        extraction_enabled: false,
        extraction_prompt: '',
        extraction_variables: [],
        prompt: `Continue the conversation fully in character as ${name}. Follow the persona. Ask or answer one thing at a time. If the caller wants to end, move to close.`,
      }),
      node(3, 'endCall', 120, 520, {
        name: 'Close',
        allow_interrupt: false,
        add_global_prompt: true,
        extraction_enabled: false,
        extraction_prompt: '',
        extraction_variables: [],
        is_end: true,
        prompt: 'Close in character in one short sentence and end the call.',
      }),
    ],
    edges: [
      edge(1, 2, 'Caller replies', 'Move here after the caller responds to the greeting.'),
      edge(2, 3, 'Ready to close', 'Move here when the conversation is done or the caller wants to hang up.'),
    ],
    viewport: { x: 150, y: 30, zoom: 0.7 },
  };
}

function recoveryDefinition(agent) {
  const name = String((agent && agent.name) || 'Recovery Agent').trim();
  const greeting = String((agent && agent.greeting) || `Namaste, this is ${name}.`).trim();
  const def = conversationDefinition(agent);
  def.nodes = [
    def.nodes[0],
    node(1, 'startCall', 120, 40, {
      name: 'Greeting',
      allow_interrupt: true,
      add_global_prompt: true,
      delayed_start: false,
      is_start: true,
      greeting_type: 'text',
      greeting,
      prompt: `Deliver the greeting as ${name}. Mention the pending payment only if that fits the persona. Ask if now is a good time.`,
    }),
    node(2, 'agentNode', 120, 260, {
      name: 'Understand Issue',
      allow_interrupt: true,
      add_global_prompt: true,
      extraction_enabled: false,
      extraction_prompt: '',
      extraction_variables: [],
      prompt: 'Listen for why payment failed or was missed. Ask one short clarifying question at a time. Stay in the persona.',
    }),
    node(3, 'agentNode', 120, 480, {
      name: 'Offer Solution',
      allow_interrupt: true,
      add_global_prompt: true,
      extraction_enabled: false,
      extraction_prompt: '',
      extraction_variables: [],
      prompt: 'Offer only recovery actions that fit what the customer said: payment link, UPI retry, card retry, approved partial payment, or EMI reschedule. Do not invent offers.',
    }),
    node(4, 'agentNode', 120, 700, {
      name: 'Capture Outcome',
      allow_interrupt: true,
      add_global_prompt: true,
      extraction_enabled: true,
      extraction_prompt: 'Capture payment outcome: paid now, promise-to-pay amount and date, refused, dispute, wrong number, or opt-out.',
      extraction_variables: [
        { name: 'outcome', type: 'string', description: 'paid_now | promise_to_pay | refused | dispute | wrong_number | opt_out | callback_requested' },
        { name: 'promised_amount', type: 'string', description: 'Amount customer agreed to pay later, if any' },
        { name: 'promised_date', type: 'string', description: 'Date customer agreed to pay, if any' },
        { name: 'preferred_channel', type: 'string', description: 'SMS, WhatsApp, UPI, card, or other' },
        { name: 'issue_reason', type: 'string', description: 'Why payment was missed' },
        { name: 'notes', type: 'string', description: 'Anything for human review' },
      ],
      prompt: 'Summarize the agreed next step in one sentence, still in character.',
    }),
    node(5, 'endCall', 120, 920, {
      name: 'Close',
      allow_interrupt: false,
      add_global_prompt: true,
      extraction_enabled: false,
      extraction_prompt: '',
      extraction_variables: [],
      is_end: true,
      prompt: 'Thank them politely in character and end the call.',
    }),
  ];
  def.edges = [
    edge(1, 2, 'Caller replies', 'Move here after the caller responds to the greeting.'),
    edge(2, 3, 'Issue understood', 'Move here once the payment issue is clear enough to offer a solution.'),
    edge(3, 4, 'Solution offered', 'Move here after offering the recovery action.'),
    edge(4, 5, 'Outcome captured', 'Move here when the next step is clear or the caller opts out.'),
  ];
  def.viewport = { x: 150, y: 30, zoom: 0.55 };
  return def;
}

function buildDefinition(agent) {
  return isRecoveryAgent(agent) ? recoveryDefinition(agent) : conversationDefinition(agent);
}

function dograhError(result, fallback) {
  const data = result && result.data;
  const detail = data && (data.detail || data.message || data.error);
  return new providers.ProviderError(
    typeof detail === 'string' ? detail : fallback,
    result && result.up ? result.up.status : 502,
    'upstream',
    typeof detail === 'string' ? detail : fallback,
  );
}

async function syncAgentWorkflow(agent) {
  if (!agent) throw new providers.ProviderError('agent required to sync Dograh workflow', 422, 'agent_required');
  const definition = buildDefinition(agent);
  const name = String(agent.name || 'Voice Agent').slice(0, 80);
  let workflowId = Number(agent.dograhWorkflowId);
  if (Number.isInteger(workflowId) && workflowId > 0) {
    const update = await providers.dograhRequest('PUT', `/api/v1/workflow/${workflowId}`, {
      name,
      workflow_definition: definition,
    });
    if (update.up.status === 404) workflowId = 0;
    else if (update.up.status < 200 || update.up.status >= 300) throw dograhError(update, 'Could not update the Dograh workflow for this agent.');
  }
  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    const created = await providers.dograhRequest('POST', '/api/v1/workflow/create/definition', {
      name,
      workflow_definition: definition,
    });
    if (created.up.status < 200 || created.up.status >= 300) {
      throw dograhError(created, 'Could not create a Dograh workflow for this agent.');
    }
    workflowId = Number(created.data && created.data.id);
  }
  if (!Number.isInteger(workflowId) || workflowId <= 0) {
    throw new providers.ProviderError('Dograh did not return a workflow id', 502, 'upstream');
  }
  const publish = await providers.dograhRequest('POST', `/api/v1/workflow/${workflowId}/publish`, {});
  if (publish.up.status < 200 || publish.up.status >= 300) {
    throw dograhError(publish, 'Could not publish the Dograh workflow for this agent.');
  }
  return workflowId;
}

module.exports = {
  spokenPersona,
  isRecoveryAgent,
  buildDefinition,
  syncAgentWorkflow,
};
