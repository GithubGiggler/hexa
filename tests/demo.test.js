'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { STEPS, playDemo } = require('../src/main/demo');
const { createBridge } = require('../src/main/bridge');

test('every step is a demo event of one session, in order', () => {
  assert.ok(STEPS.length >= 20);
  for (const [delay, evt] of STEPS) {
    assert.ok(Number.isFinite(delay) && delay >= 0);
    assert.equal(typeof evt.hook_event_name, 'string');
    assert.equal(evt.demo, true);
    assert.equal(evt.session_id, 'demo-session');
  }
  const names = STEPS.map(([, e]) => e.hook_event_name);
  assert.equal(names[0], 'SessionStart');
  assert.equal(names[1], 'UserPromptSubmit');
  assert.ok(names.includes('PostToolUseFailure'));
  assert.ok(names.includes('Notification'));
  assert.ok(names.indexOf('Stop') > names.indexOf('Notification'));
  assert.equal(names.at(-1), 'HexaShowcase');
  const failure = STEPS.find(([, e]) => e.hook_event_name === 'PostToolUseFailure')[1];
  assert.match(failure.error, /Cannot find module 'zod'/);
});

test('playDemo sends every step in order, and cancel stops it', async () => {
  const sent = [];
  const done = new Promise((resolve) => {
    playDemo((evt) => { sent.push(evt.hook_event_name); if (sent.length === STEPS.length) resolve(); }, { speed: 1000 });
  });
  await done;
  assert.deepEqual(sent, STEPS.map(([, e]) => e.hook_event_name));

  const some = [];
  const cancel = playDemo((evt) => some.push(evt), { speed: 1000 });
  cancel();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(some.length < STEPS.length);
});

test('scripts/demo.js posts the demo to the socket', async () => {
  const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-demo-')), 'run', 'hexa.sock');
  const got = [];
  const bridge = await createBridge({ socketPath, onEvent: (e) => got.push(e) });
  try {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], {
        env: { ...process.env, HEXA_SOCKET: socketPath, HEXA_DEMO_SPEED: '1000' },
      });
      child.on('close', resolve);
    });
    assert.equal(code, 0);
    assert.equal(got.length, STEPS.length);
  } finally {
    await bridge.close();
  }
});

test('scripts/demo.js explains when Hexa is not running', async () => {
  const out = await new Promise((resolve) => {
    let text = '';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], {
      env: { ...process.env, HEXA_SOCKET: '/nonexistent/hexa.sock', HEXA_DEMO_SPEED: '1000' },
    });
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, text }));
  });
  assert.equal(out.code, 1);
  assert.match(out.text, /Hexa isn't running/);
});
