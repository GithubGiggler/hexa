'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCli, createSessionList } = require('../src/main/cli');

// The pieces main hands to createCli, as recorders.
function rig(over = {}) {
  const sent = [];
  const notified = [];
  const calls = [];
  let cfg = { visible: true };
  const deps = {
    send: (channel, payload) => sent.push({ channel, payload }),
    config: { load: () => cfg },
    actions: {
      toggle: () => { calls.push('toggle'); cfg = { ...cfg, visible: !cfg.visible }; },
      demo: () => calls.push('demo'),
    },
    notify: async (n) => { notified.push(n); return 7; },
    hooks: {
      install: () => { calls.push('install'); return { ok: true, file: '/c/settings.json', events: 13 }; },
      uninstall: () => { calls.push('uninstall'); return { file: '/c/settings.json', removed: true }; },
      status: () => ({ file: '/c/settings.json', installed: true, events: ['Stop'] }),
    },
    sessions: () => [{ id: 's1', project: 'penguin-api', state: 'working' }],
    linux: () => ({ dnd: true, music: { playing: true, player: 'Spotify', title: 'T', artist: 'A' } }),
    version: '0.1.0',
    ...over,
  };
  return { cli: createCli(deps), sent, notified, calls, setVisible: (v) => { cfg = { ...cfg, visible: v }; } };
}

test('say: a HexaSay event for the renderer, cleaned and capped', async () => {
  const { cli, sent } = rig();
  const r = await cli.handle('say', { text: '  hello\n\tthere‮  ', face: 'laugh' });
  assert.equal(r.status, 200);
  assert.deepEqual(sent, [{ channel: 'hexa:event', payload: { assistant: 'cli', session_id: 'cli', hook_event_name: 'HexaSay', text: 'hello there', face: 'laugh' } }]);
  await cli.handle('say', { text: 'x'.repeat(1000) });
  assert.equal(sent[1].payload.text, 'x'.repeat(280) + '…');
  assert.equal(sent[1].payload.face, undefined);
});

test('say: nothing to say, or a face that is not a glyph name, is a 400 and sends nothing', async () => {
  const { cli, sent } = rig();
  for (const body of [{}, { text: '   ' }, { text: 5 }, { text: 'hi', face: '<b>' }, { text: 'hi', face: 3 }, { text: 'hi', face: 'x'.repeat(40) }]) {
    assert.equal((await cli.handle('say', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(sent.length, 0);
});

test('a request cannot pass itself off as a Claude event', async () => {
  const { cli, sent } = rig();
  await cli.handle('say', { text: 'hi', hook_event_name: 'Notification', notification_type: 'permission_prompt', assistant: 'claude', session_id: 'real', tool_name: 'Bash' });
  assert.deepEqual(sent[0].payload, { assistant: 'cli', session_id: 'cli', hook_event_name: 'HexaSay', text: 'hi' });
});

test('nothing here approves anything: permission-like commands are unknown', async () => {
  const { cli, sent, calls } = rig();
  for (const cmd of ['permission', 'approve', 'allow', 'answer', 'permission/answer', '__proto__', 'constructor', 'hasOwnProperty', '']) {
    const r = await cli.handle(cmd, { id: 'x', behavior: 'allow' });
    assert.equal(r.status, 404, cmd);
    assert.equal(r.body.ok, false);
  }
  assert.equal(sent.length, 0);
  assert.equal(calls.length, 0);
});

test('react: the five reactions, nothing else', async () => {
  const { cli, sent } = rig();
  for (const reaction of ['done', 'error', 'alert', 'hello', 'fork']) {
    assert.equal((await cli.handle('react', { reaction })).status, 200);
  }
  assert.deepEqual(sent.map((s) => s.payload.reaction), ['done', 'error', 'alert', 'hello', 'fork']);
  assert.equal(sent[0].payload.hook_event_name, 'HexaReact');
  assert.equal((await cli.handle('react', { reaction: 'toString' })).status, 400);
  assert.equal((await cli.handle('react', {})).status, 400);
  assert.equal(sent.length, 5);
});

test('run-start and run-end become HexaRun events', async () => {
  const { cli, sent } = rig();
  assert.equal((await cli.handle('run-start', { run_id: 'abcdef012345', command: 'npm test', cwd: '/home/you/penguin-api' })).status, 200);
  assert.equal((await cli.handle('run-end', { run_id: 'abcdef012345', command: 'npm test', cwd: '/home/you/penguin-api', code: 1, signal: null, duration_ms: 1234.4 })).status, 200);
  assert.deepEqual(sent.map((s) => s.payload), [
    { assistant: 'cli', session_id: 'cli', hook_event_name: 'HexaRun', phase: 'start', run_id: 'abcdef012345', command: 'npm test', cwd: '/home/you/penguin-api' },
    { assistant: 'cli', session_id: 'cli', hook_event_name: 'HexaRun', phase: 'end', run_id: 'abcdef012345', command: 'npm test', cwd: '/home/you/penguin-api', code: 1, signal: null, duration_ms: 1234, ok: false },
  ]);
});

test('run-end: a signal, a success, and bad values', async () => {
  const { cli, sent } = rig();
  await cli.handle('run-end', { run_id: 'abcdef01', command: 'sleep 9', code: null, signal: 'SIGTERM' });
  assert.equal(sent[0].payload.signal, 'SIGTERM');
  assert.equal(sent[0].payload.code, null);
  assert.equal(sent[0].payload.duration_ms, null);
  await cli.handle('run-end', { run_id: 'abcdef01', command: 'true', code: 0 });
  assert.equal(sent[1].payload.ok, true);
  for (const body of [
    { run_id: 'abcdef01', command: 'x', code: 256 },
    { run_id: 'abcdef01', command: 'x', code: -1 },
    { run_id: 'abcdef01', command: 'x', code: '0' },
    { run_id: 'abcdef01', command: 'x', signal: 'KILL' },
    { run_id: 'abcdef01', command: 'x', signal: 'SIG; rm -rf' },
    { run_id: 'nothex!!', command: 'x', code: 0 },
    { run_id: 'abc', command: 'x', code: 0 },
    { run_id: 'abcdef01', command: '', code: 0 },
  ]) {
    assert.equal((await cli.handle('run-end', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(sent.length, 2);
});

test('run: a long command is capped, a relative cwd is dropped', async () => {
  const { cli, sent } = rig();
  await cli.handle('run-start', { run_id: 'abcdef01', command: 'x'.repeat(500), cwd: 'relative/dir' });
  assert.equal(sent[0].payload.command.length, 201);
  assert.equal('cwd' in sent[0].payload, false);
});

test('notify goes through notifications.js with a title and an optional body', async () => {
  const { cli, notified } = rig();
  const r = await cli.handle('notify', { title: 'Build', body: 'line 1\nline 2' });
  assert.deepEqual(r.body, { ok: true, id: 7 });
  assert.deepEqual(notified, [{ title: 'Build', body: 'line 1\nline 2' }]);
  assert.equal((await cli.handle('notify', { body: 'no title' })).status, 400);
  assert.equal(notified.length, 1);
});

test('notify: never any buttons, so nothing can be answered from it', async () => {
  const { cli, notified } = rig();
  await cli.handle('notify', { title: 't', actions: [{ id: 'allow', label: 'Allow' }] });
  assert.equal(notified[0].actions, undefined);
});

test('status reports what main knows', async () => {
  const { cli } = rig();
  const r = await cli.handle('status', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.name, 'hexa');
  assert.equal(r.body.version, '0.1.0');
  assert.equal(r.body.pid, process.pid);
  assert.equal(r.body.visible, true);
  assert.equal(r.body.dnd, true);
  assert.deepEqual(r.body.music, { playing: true, player: 'Spotify', title: 'T', artist: 'A' });
  assert.equal(r.body.sessions, 1);
  assert.deepEqual(r.body.hooks, { installed: true });
});

test('sessions lists them', async () => {
  const { cli } = rig();
  assert.deepEqual((await cli.handle('sessions', {})).body, { ok: true, sessions: [{ id: 's1', project: 'penguin-api', state: 'working' }] });
});

test('show and hide are sets, toggle flips; all through the tray’s toggle', async () => {
  const { cli, calls, setVisible } = rig();
  assert.deepEqual((await cli.handle('show', {})).body, { ok: true, visible: true });
  assert.deepEqual(calls, []); // already there
  assert.deepEqual((await cli.handle('hide', {})).body, { ok: true, visible: false });
  assert.deepEqual((await cli.handle('hide', {})).body, { ok: true, visible: false });
  assert.deepEqual(calls, ['toggle']);
  assert.deepEqual((await cli.handle('show', {})).body, { ok: true, visible: true });
  assert.deepEqual((await cli.handle('toggle', {})).body, { ok: true, visible: false });
  assert.deepEqual(calls, ['toggle', 'toggle', 'toggle']);
  setVisible(true);
});

test('demo plays the tray’s demo', async () => {
  const { cli, calls } = rig();
  assert.equal((await cli.handle('demo', {})).status, 200);
  assert.deepEqual(calls, ['demo']);
});

test('hooks: install, uninstall, status; anything else is a 400', async () => {
  const { cli, calls } = rig();
  assert.deepEqual((await cli.handle('hooks', { action: 'install' })).body, { ok: true, action: 'install', file: '/c/settings.json', events: 13 });
  assert.deepEqual((await cli.handle('hooks', { action: 'uninstall' })).body, { ok: true, action: 'uninstall', file: '/c/settings.json', removed: true });
  assert.equal((await cli.handle('hooks', { action: 'status' })).body.installed, true);
  assert.equal((await cli.handle('hooks', { action: 'rm -rf' })).status, 400);
  assert.equal((await cli.handle('hooks', {})).status, 400);
  assert.equal((await cli.handle('hooks', { action: 'install', assistant: 'cursor' })).status, 400);
  assert.equal((await cli.handle('hooks', { action: 'install', assistant: 42 })).status, 400);
  assert.deepEqual(calls, ['install', 'uninstall']);
});

test('hooks: --assistant picks whose (claude by default; antigravity is agy)', async () => {
  const asked = [];
  const { cli } = rig({
    hooks: {
      install: (a) => { asked.push(['install', a]); return { file: `/${a}/hooks.json`, events: 1 }; },
      uninstall: (a) => { asked.push(['uninstall', a]); return { file: `/${a}/hooks.json`, removed: false }; },
      status: (a) => { asked.push(['status', a]); return { file: `/${a}/hooks.json`, installed: false, events: [] }; },
    },
  });
  assert.equal((await cli.handle('hooks', { action: 'install', assistant: 'codex' })).body.file, '/codex/hooks.json');
  await cli.handle('hooks', { action: 'uninstall', assistant: 'Antigravity' });
  await cli.handle('hooks', { action: 'status', assistant: 'agy' });
  await cli.handle('hooks', { action: 'status' });
  assert.deepEqual(asked, [['install', 'codex'], ['uninstall', 'agy'], ['status', 'agy'], ['status', 'claude']]);
  const bad = await cli.handle('hooks', { action: 'install', assistant: 'cursor' });
  assert.match(bad.body.error, /cursor.*claude, codex, agy/);
});

test('status: the hooks of the assistant she watches, with any warning', async () => {
  const asked = [];
  const { cli } = rig({
    config: { load: () => ({ visible: true, assistant: 'codex' }) },
    hooks: { status: (a) => { asked.push(a); return { installed: true, warning: 'hooks are off' }; } },
  });
  const r = await cli.handle('status', {});
  assert.equal(r.body.assistant, 'codex');
  assert.deepEqual(r.body.hooks, { installed: true, warning: 'hooks are off' });
  assert.deepEqual(asked, ['codex']);
  assert.equal(r.body.sessions, 0, 'the rig’s one session is Claude Code’s');
  const two = rig({
    config: { load: () => ({ assistant: 'codex' }) },
    sessions: () => [{ id: 'codex:a', assistant: 'codex' }, { id: 'b', assistant: 'claude' }, { id: 'codex:c', assistant: 'codex' }],
  });
  assert.equal((await two.cli.handle('status', {})).body.sessions, 2);
  const odd = rig({ config: { load: () => ({ assistant: 'nope' }) } });
  assert.equal((await odd.cli.handle('status', {})).body.assistant, 'claude');
});

test('hooks: a failure is a 500 with its reason', async () => {
  const { cli } = rig({
    hooks: {
      install: () => ({ ok: false, error: 'settings.json is not valid JSON' }),
      uninstall: () => { throw new Error('read-only file system'); },
      status: () => ({}),
    },
  });
  assert.deepEqual((await cli.handle('hooks', { action: 'install' })), { status: 500, body: { ok: false, error: 'settings.json is not valid JSON' } });
  assert.deepEqual((await cli.handle('hooks', { action: 'uninstall' })), { status: 500, body: { ok: false, error: 'read-only file system' } });
});

test('stats: 404 until someone provides it; then the range is checked and passed on', async () => {
  assert.equal((await rig().cli.handle('stats', {})).status, 404);
  const asked = [];
  const { cli } = rig({ stats: async (q) => { asked.push(q); return { tasks: 3 }; } });
  assert.deepEqual((await cli.handle('stats', { range: 'week' })).body, { ok: true, tasks: 3 });
  assert.deepEqual((await cli.handle('stats', {})).body, { ok: true, tasks: 3 });
  assert.equal((await cli.handle('stats', { range: 'year' })).status, 400);
  assert.deepEqual(asked, [{ range: 'week' }, { range: 'today' }]);
});

test('a body that is not an object is a 400', async () => {
  const { cli, sent } = rig();
  for (const body of [null, [], 'text', 5]) assert.equal((await cli.handle('say', body)).status, 400);
  assert.equal((await cli.handle('status')).status, 200); // GETs may come without one
  assert.equal(sent.length, 0);
});

test('session list: follows Claude’s events, ignores the demo and the CLI, ends and goes stale', () => {
  let t = 1_000_000;
  const list = createSessionList({ now: () => t });
  list.see({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/home/you/penguin-api', assistant: 'claude' });
  list.see({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash' });
  t += 1000;
  list.see({ hook_event_name: 'Notification', session_id: 'b', cwd: '/home/you/other', notification_type: 'permission_prompt' });
  list.see({ hook_event_name: 'PreToolUse', session_id: 'demo-session', demo: true });
  list.see({ hook_event_name: 'HexaSay', session_id: 'cli', assistant: 'cli' });
  let l = list.list();
  assert.deepEqual(l.map((s) => [s.id, s.project, s.state]), [['b', 'other', 'waiting'], ['a', 'penguin-api', 'working']]);
  assert.equal(l[1].tool, 'Bash');
  assert.equal(l[1].events, 2);

  list.see({ hook_event_name: 'PostToolUseFailure', session_id: 'a', tool_name: 'Bash' });
  assert.equal(list.list().find((s) => s.id === 'a').state, 'error');
  list.see({ hook_event_name: 'Stop', session_id: 'a' });
  assert.equal(list.list().find((s) => s.id === 'a').state, 'done');
  list.see({ hook_event_name: 'SessionEnd', session_id: 'b' });
  l = list.list();
  assert.deepEqual(l.map((s) => s.id), ['a']);

  t += 31 * 60 * 1000;
  assert.deepEqual(list.list(), []);
});

test('session list: a copy each time, and capped', () => {
  const list = createSessionList();
  for (let i = 0; i < 100; i++) list.see({ hook_event_name: 'PreToolUse', session_id: `s${i}` });
  const l = list.list();
  assert.equal(l.length, 64);
  l[0].state = 'tampered';
  assert.notEqual(list.list()[0].state, 'tampered');
});
