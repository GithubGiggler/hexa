'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChat } = require('../src/main/brain/chat');
const { createActions, findApp, execArgv, homePath } = require('../src/main/brain/actions');

// a scripted brain: each chat() returns the next reply
function scripted(name, replies) {
  const seen = [];
  return {
    seen,
    brain: {
      name,
      async chat(req) {
        seen.push(JSON.parse(JSON.stringify({ messages: req.messages, tools: req.tools?.map((t) => t.name) })));
        const r = replies.shift();
        if (r.text) req.onText(r.text);
        return { content: r.content ?? r.text, text: r.text || '', stopReason: r.stop || 'end_turn' };
      },
    },
  };
}

function rig(name, replies, ctx = {}) {
  const s = scripted(name, replies);
  const events = [];
  const actions = createActions({ openExternal: async (u) => events.push(['opened', u]), openPath: async () => '', remind: () => {}, lookAtScreen: async () => null, useComputer: async () => ({ started: false, reason: 'off' }), ...ctx });
  const chat = createChat({ getBrain: () => ({ brain: s.brain, model: 'm', key: name }), actions, onEvent: (e) => events.push(e), user: 'you' });
  return { chat, events, seen: s.seen };
}

test('a local brain: plain text, no tools, the reply streamed', async () => {
  const { chat, events, seen } = rig('ollama', [{ text: 'Hi.' }]);
  await chat.send('hello');
  assert.equal(seen[0].tools, undefined);
  assert.match(seen[0].messages[0].content, /hello$/);
  assert.deepEqual(events.map((e) => e.type), ['start', 'delta', 'done']);
  assert.equal(events.at(-1).text, 'Hi.');
});

test('Claude: a tool call runs, its result goes back, and she goes on', async () => {
  const toolUse = { type: 'tool_use', id: 't1', name: 'open_url', input: { url: 'https://example.com/x' } };
  const { chat, events, seen } = rig('claude', [
    { content: [{ type: 'text', text: 'On it.' }, toolUse], text: 'On it.', stop: 'tool_use' },
    { text: 'Opened it.' },
  ]);
  await chat.send('open example.com');
  assert.ok(seen[0].tools.includes('open_url') && seen[0].tools.includes('use_computer'));
  assert.deepEqual(events.find((e) => e[0] === 'opened'), ['opened', 'https://example.com/x']);
  assert.ok(events.some((e) => e.type === 'action' && /OPENS example\.com/.test(e.label)));
  const results = seen[1].messages.at(-1).content;
  assert.deepEqual(results, [{ type: 'tool_result', tool_use_id: 't1', content: 'Opened example.com.' }]);
  assert.deepEqual(seen[1].messages[1].content, [{ type: 'text', text: 'On it.' }, toolUse], 'her reply goes back unchanged');
  assert.equal(events.at(-1).text, 'Opened it.');
});

test('bad tool input never runs: an error result instead', async () => {
  const { chat, events, seen } = rig('claude', [
    { content: [{ type: 'tool_use', id: 't1', name: 'open_url', input: { url: 'file:///etc/passwd' } }], stop: 'tool_use' },
    { text: 'Can\'t.' },
  ]);
  await chat.send('open that');
  assert.ok(!events.some((e) => e[0] === 'opened'));
  assert.equal(seen[1].messages.at(-1).content[0].is_error, true);
});

test('history is append-only; switching brains starts over', async () => {
  const s = scripted('claude', [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  let key = 'claude:x';
  const chat = createChat({ getBrain: () => ({ brain: s.brain, model: 'm', key }), actions: createActions({}), onEvent: () => {} });
  await chat.send('one');
  await chat.send('two');
  assert.equal(s.seen[1].messages.length, 3);
  assert.deepEqual(s.seen[1].messages.slice(0, 2), s.seen[0].messages.concat([{ role: 'assistant', content: 'a' }]).slice(0, 2));
  key = 'ollama:y';
  await chat.send('three');
  assert.equal(s.seen[2].messages.length, 1);
});

test('apps: found by name in .desktop files, Exec run without a shell or field codes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-apps-'));
  fs.writeFileSync(path.join(dir, 'org.mozilla.firefox.desktop'), '[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox %u\n');
  fs.writeFileSync(path.join(dir, 'hidden.desktop'), '[Desktop Entry]\nType=Application\nName=Firefox Helper\nNoDisplay=true\nExec=x\n');
  fs.writeFileSync(path.join(dir, 'org.kde.dolphin.desktop'), '[Desktop Entry]\nType=Application\nName=Dolphin\nGenericName=File Manager\nExec=dolphin %u\n');
  assert.equal(findApp('firefox', [dir]).id, 'org.mozilla.firefox.desktop');
  assert.equal(findApp('file manager', [dir]).name, 'Dolphin');
  assert.equal(findApp('nope', [dir]), null);
  assert.deepEqual(execArgv('env "A B" foo --x=%f %U'), ['env', 'A B', 'foo', '--x=%f']);
});

test('paths: only inside your home', () => {
  assert.equal(homePath('~/Documents', '/home/u'), '/home/u/Documents');
  assert.equal(homePath('Downloads', '/home/u'), '/home/u/Downloads');
  assert.equal(homePath('~/../other', '/home/u'), null);
  assert.equal(homePath('/etc', '/home/u'), null);
});

test('reminders and media are checked before they run', async () => {
  const set = [];
  const a = createActions({ remind: (m, t) => set.push([m, t]), media: async (act) => (act === 'status' ? 'Song by Band' : 'OK') });
  assert.ok((await a.call('set_reminder', { minutes: 0, text: 'x' })).error);
  assert.ok((await a.call('set_reminder', { minutes: 10, text: 'stretch' })).ok);
  assert.deepEqual(set, [[10, 'stretch']]);
  assert.equal((await a.call('media', { action: 'status' })).ok, 'Song by Band');
  assert.ok((await a.call('media', { action: 'rm -rf' })).error);
  assert.ok((await a.call('nope', {})).error);
});
