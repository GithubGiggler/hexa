'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ollama, claudeBrain, ollamaBase } = require('../src/main/brain/providers');

// a stand-in Ollama: /api/tags and a streaming /api/chat
function fakeOllama({ chunks = ['Hel', 'lo.'], error } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ path: req.url, body: body ? JSON.parse(body) : null });
      if (req.url === '/api/tags') {
        return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:14b', size: 9e9, details: { parameter_size: '14.8B' } }, { name: 'llama3.2:3b', size: 2e9, details: { parameter_size: '3.2B' } }] }));
      }
      for (const c of chunks) res.write(`${JSON.stringify({ message: { role: 'assistant', content: c }, done: false })}\n`);
      if (error) res.write(`${JSON.stringify({ error })}\n`);
      res.end(`${JSON.stringify({ done: true })}\n`);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.OLLAMA_HOST = `127.0.0.1:${server.address().port}`;
    resolve({ server, seen });
  }));
}

test('OLLAMA_HOST with or without a scheme', () => {
  process.env.OLLAMA_HOST = 'box:1234';
  assert.equal(ollamaBase(), 'http://box:1234');
  process.env.OLLAMA_HOST = 'https://box';
  assert.equal(ollamaBase(), 'https://box');
});

test('local models: smallest first, with their sizes', async () => {
  const { server } = await fakeOllama();
  const models = await ollama.listModels();
  server.close();
  assert.deepEqual(models.map((m) => m.id), ['llama3.2:3b', 'qwen2.5:14b']);
  assert.match(models[0].label, /3\.2B/);
});

test('a local chat streams and sends her system prompt first, as plain text', async () => {
  const { server, seen } = await fakeOllama();
  const deltas = [];
  const r = await ollama.chat({ model: 'llama3.2:3b', system: 'You are Hexa.', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], onText: (d) => deltas.push(d) });
  server.close();
  assert.equal(r.text, 'Hello.');
  assert.deepEqual(deltas, ['Hel', 'lo.']);
  const body = seen.find((s) => s.path === '/api/chat').body;
  assert.deepEqual(body.messages, [{ role: 'system', content: 'You are Hexa.' }, { role: 'user', content: 'hi' }]);
  assert.equal(body.stream, true);
});

test('an error in the stream rejects; no Ollama says so', async () => {
  const { server } = await fakeOllama({ error: 'model not found' });
  await assert.rejects(ollama.chat({ model: 'x', system: '', messages: [] }), /model not found/);
  server.close();
  process.env.OLLAMA_HOST = '127.0.0.1:1';
  await assert.rejects(ollama.listModels(), /isn't running|ECONNREFUSED/);
});

// a stand-in Anthropic client: records the request, streams two text deltas
function fakeClient(final = { content: [{ type: 'text', text: 'Hi there.' }], stop_reason: 'end_turn', model: 'claude-opus-5-5' }) {
  const calls = [];
  return {
    calls,
    models: { async *list() { yield { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }; yield { id: 'not-claude' }; } },
    beta: {
      messages: {
        stream(params, opts) {
          calls.push({ params, opts });
          const handlers = {};
          return {
            on(k, fn) { handlers[k] = fn; return this; },
            async finalMessage() { handlers.text?.('Hi '); handlers.text?.('there.'); return final; },
          };
        },
      },
    },
  };
}

test('Claude: streams at low effort, with refusal fallbacks on the models that take them', async () => {
  const fake = fakeClient();
  const brain = claudeBrain({ createClient: () => fake });
  const deltas = [];
  const r = await brain.chat({ model: 'claude-opus-5-5', system: 'You are Hexa.', messages: [{ role: 'user', content: 'hi' }], onText: (d) => deltas.push(d) });
  assert.equal(r.text, 'Hi there.');
  assert.deepEqual(deltas, ['Hi ', 'there.']);
  const p = fake.calls[0].params;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.equal(p.fallbacks, 'default');
  assert.ok(p.betas.includes('server-side-fallback-2026-07-01'));
  assert.equal(p.thinking, undefined, 'thinking left to the model (adaptive)');
  await brain.chat({ model: 'claude-haiku-5-5', system: '', messages: [] });
  assert.equal(fake.calls[1].params.fallbacks, undefined, 'no server-side fallback on Haiku');
  assert.deepEqual(await brain.listModels(), [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }]);
});
