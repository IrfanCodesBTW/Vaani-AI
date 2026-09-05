'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDefinition, spokenPersona, isRecoveryAgent } = require('../lib/agent-workflow');

test('recovery agents keep the recovery graph and speak their greeting', () => {
  const agent = {
    name: 'VaapasAI Recovery Agent',
    persona: 'You are VaapasAI. Help with pending payments without pressure.',
    greeting: 'Namaste, main VaapasAI se bol raha hoon.',
    tts: { provider: 'rumik', voice: 'ira' },
  };
  assert.equal(isRecoveryAgent(agent), true);
  const def = buildDefinition(agent);
  const global = def.nodes.find((n) => n.type === 'globalNode');
  const start = def.nodes.find((n) => n.type === 'startCall');
  assert.match(global.data.prompt, /VaapasAI/);
  assert.equal(start.data.greeting_type, 'text');
  assert.equal(start.data.greeting, agent.greeting);
  assert.equal(def.nodes.some((n) => n.data.name === 'Offer Solution'), true);
  assert.match(spokenPersona(agent), /Never say you are a customer service bot/);
});

test('general agents get a conversation graph built from persona and greeting', () => {
  const agent = {
    name: "Irfan's Assistant",
    persona: 'You are Irfan\'s Assistant. Be witty and brag about Irfan as me.',
    greeting: "Hey! You're talking to Irfan's Assistant.",
    tts: { provider: 'sarvam', voice: 'priya' },
  };
  assert.equal(isRecoveryAgent(agent), false);
  const def = buildDefinition(agent);
  const global = def.nodes.find((n) => n.type === 'globalNode');
  const start = def.nodes.find((n) => n.type === 'startCall');
  assert.match(global.data.prompt, /Irfan's Assistant/);
  assert.match(global.data.prompt, /witty/);
  assert.equal(start.data.greeting, agent.greeting);
  assert.doesNotMatch(JSON.stringify(def), /Welcome to customer service/i);
  assert.equal(def.nodes.filter((n) => n.type === 'agentNode').length, 1);
});
