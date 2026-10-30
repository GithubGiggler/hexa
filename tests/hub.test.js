'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHub, createAsker } = require('../src/main/brain/hub');

function rig(cfg = {}) {
  let conf = { brain: 'max', brainModels: {}, computerUse: false, ...cfg };
  const sent = [];
  const hub = createHub({
    config: { load: () => conf, save: (p) => { conf = { ...conf, ...p }; } },
    secrets: { load: () => null, has: () => false, keyringOk: () => true, save() {}, clear() {} },
    send: (ch, p) => sent.push([ch, p]),
    shell: { openExternal: async () => {}, openPath: async () => '' },
    capture: { capture: async () => ({ data: 'x', width: 1, height: 1 }) },
    x11: { hasInput: true, input: async () => ({}) },
    grabEscape: () => () => {},
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-hub-')),
    onReminder: () => {},
  });
  return { hub, sent, conf: () => conf };
}

test('her brain settings: only the three brains, a model per brain, computer use on or off', async () => {
  const { hub, conf } = rig();
  await hub.set({ brain: 'bigger' });
  await hub.set({ brain: 'rm -rf' });
  await hub.set({ tier: 'normal', model: 'llama3.2:3b' });
  await hub.set({ computerUse: true });
  assert.equal(conf().brain, 'bigger');
  assert.deepEqual(conf().brainModels, { normal: 'llama3.2:3b' });
  assert.equal(conf().computerUse, true);
});

test('computer use: off or not on Claude, refused without asking; on, your consent first, and no means no', async () => {
  const off = rig();
  assert.match((await off.hub.useComputer('open the settings')).reason, /off/);
  assert.equal(off.sent.length, 0, 'not even a card');
  const local = rig({ computerUse: true, brain: 'normal' });
  assert.match((await local.hub.useComputer('x')).reason, /Max intelligence/);
  const on = rig({ computerUse: true });
  const pending = on.hub.useComputer('open the settings');
  const [ch, card] = on.sent[0];
  assert.equal(ch, 'brain:ask');
  assert.equal(card.kind, 'consent');
  assert.equal(card.task, 'open the settings');
  on.hub.answer(card.id, 'cancel');
  const r = await pending;
  assert.equal(r.started, false);
  assert.ok(!on.sent.some(([c]) => c === 'computer:start'));
});

test('asker: one answer per question, by its id; timing out gives the default', async () => {
  const sent = [];
  let fire;
  const a = createAsker((ch, p) => sent.push([ch, p]), { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout() {} });
  const q = a.ask('consent', { task: 't' }, { otherwise: 'no' });
  const { id } = sent[0][1];
  assert.equal(a.answer('wrong', 'start'), false);
  assert.equal(a.answer(id, 'start'), true);
  assert.equal(a.answer(id, 'start'), false, 'once');
  assert.equal(await q, 'start');
  const q2 = a.ask('consent', { task: 't' }, { otherwise: 'no' });
  fire();
  assert.equal(await q2, 'no');
  assert.equal(sent.at(-1)[0], 'brain:gone');
});

test('make her yours: "call me", "remember that", "forget everything", answered by her, no model needed', async () => {
  const { hub, sent, conf } = rig({ brain: 'max' });
  await hub.send('call me Captain');
  assert.equal(conf().userName, 'Captain');
  assert.match(sent.filter(([c]) => c === 'chat:event').map(([, e]) => e.text).join(' '), /Captain/);
  await hub.send('remember that I deploy on Fridays');
  await hub.send('Remember that my cat is called Segfault');
  assert.deepEqual(conf().memories, ['I deploy on Fridays', 'my cat is called Segfault']);
  await hub.send('remember that I deploy on Fridays');
  assert.equal(conf().memories.length, 2, 'once');
  await hub.send('forget everything');
  assert.deepEqual(conf().memories, []);
});

test('what she knows about you goes into who she is', () => {
  const { chatSystem } = require('../src/main/brain/persona');
  const s = chatSystem({ user: 'Captain', tools: true, stage: { name: 'Trusted', index: 3 }, memories: ['my cat is called Segfault'], days: 30 });
  assert.match(s, /Captain/);
  assert.match(s, /Trusted/);
  assert.match(s, /Segfault/);
  assert.doesNotMatch(chatSystem({ tools: false }), /remember/i);
});

test('she answers in your language', () => {
  const { chatSystem } = require('../src/main/brain/persona');
  assert.match(chatSystem({ lang: 'de' }), /Answer in German/);
  assert.doesNotMatch(chatSystem({ lang: 'en' }), /Answer in/);
});
