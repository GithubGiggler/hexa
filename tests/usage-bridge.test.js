'use strict';

// Events in over the socket, numbers out of /cli/stats: wired the way main.js wires them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createBridge } = require('../src/main/bridge');
const { createHistory } = require('../src/main/usage/history');
const { loadPrices } = require('../src/main/usage/prices');
const { statsCli } = require('../src/main/usage/report');

function request(socketPath, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ socketPath, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('hook events reach her history, and /cli/stats answers in JSON', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-usage-br-'));
  const socketPath = path.join(root, 'run', 'hexa.sock');
  const transcript = path.join(root, 's.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20 } } }) + '\n');
  const history = createHistory({ dir: path.join(root, 'history'), prices: loadPrices({ file: '/nonexistent' }), log: { warn() {}, error() {} } });
  const reads = [];
  const bridge = await createBridge({
    socketPath,
    onEvent: (evt) => reads.push(history.record(evt)),
    onCli: async (cmd, body) => (cmd === 'stats' ? statsCli(history, body) : { status: 404, body: { ok: false } }),
  });
  try {
    const ev = (e) => request(socketPath, 'POST', '/event', { session_id: 's', cwd: '/w/capri', ...e });
    await ev({ hook_event_name: 'UserPromptSubmit', prompt: 'go' });
    await ev({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/w/capri/x.js', content_len: 10 } });
    await ev({ hook_event_name: 'Stop', transcript_path: transcript });
    await Promise.all(reads);

    const week = await request(socketPath, 'GET', '/cli/stats?range=week');
    assert.equal(week.status, 200);
    assert.equal(week.body.ok, true);
    assert.equal(week.body.range, 'week');
    assert.equal(week.body.days, 7);
    assert.equal(week.body.tasks, 1);
    assert.equal(week.body.filesChanged, 1);
    assert.equal(week.body.tokens['claude-opus-5-5'].output, 20);
    assert.equal(week.body.cost.estimate, true);
    assert.equal((await request(socketPath, 'GET', '/cli/stats')).body.range, 'today');
    assert.equal((await request(socketPath, 'GET', '/cli/stats?range=year')).status, 400);
  } finally {
    await bridge.close();
    history.flush();
  }
});
