'use strict';

// bin/hexa.js, run as you'd run it, against a stand-in for the app on a temporary socket.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parse, requestFor, display, describeSessions, describeStatus } = require('../bin/hexa');

const BIN = path.join(__dirname, '..', 'bin', 'hexa.js');
const NOWHERE = '/nonexistent/hexa-test/hexa.sock';

function tempSocket() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-cli-')), 'hexa.sock');
}

// Resolves { code, signal, stdout, stderr } once the CLI exits. onStdout(text, child) sees output as it comes.
function hexa(args, { socket = NOWHERE, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, HEXA_SOCKET: socket } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (s) => {
      stdout += s;
      onStdout?.(stdout, child);
    });
    child.stderr.on('data', (s) => { stderr += s; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end();
  });
}

// A stand-in for the app: records each request; answer(route, body) gives [status, body].
async function app(answer = () => [200, { ok: true }]) {
  const socket = tempSocket();
  const received = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (c) => { text += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://hexa');
      const body = text ? JSON.parse(text) : null;
      received.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, origin: req.headers.origin });
      const [status, out] = answer(url.pathname, body) || [200, { ok: true }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(socket, r));
  server.unref(); // a test that fails before close() must not hold the whole file open
  return { socket, received, close: () => new Promise((r) => server.close(r)) };
}

test('--help: usage and the exit codes, on stdout, exit 0', async () => {
  const r = await hexa(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: hexa <command>/);
  assert.match(r.stdout, /Exit codes:/);
  assert.match(r.stdout, /run -- <command…>/);
});

test('no command, an unknown one, or bad arguments: exit 2 and nothing sent', async () => {
  const a = await app();
  for (const args of [[], ['dance'], ['react', 'cartwheel'], ['say'], ['notify'], ['notify', '--body', 'b'], ['say', 'hi', '--face'], ['status', '--colour'], ['stats', '--week', '--month'], ['hooks', 'reinstall'], ['run'], ['run', '--'], ['show', 'now']]) {
    const r = await hexa(args, { socket: a.socket });
    assert.equal(r.code, 2, args.join(' '));
    assert.ok(r.stderr.length > 0, args.join(' '));
  }
  assert.deepEqual(a.received, []);
  await a.close();
});

test('say: the text (all of its words) and the face, silently', async () => {
  const a = await app();
  const r = await hexa(['say', 'build', 'is', 'green', '--face', 'laugh'], { socket: a.socket });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.deepEqual(a.received, [{ method: 'POST', path: '/cli/say', query: {}, body: { text: 'build is green', face: 'laugh' }, origin: undefined }]);
  await hexa(['say', '--face=wide', '--', '--not-a-flag'], { socket: a.socket });
  assert.deepEqual(a.received[1].body, { text: '--not-a-flag', face: 'wide' });
  await a.close();
});

test('react and notify', async () => {
  const a = await app();
  assert.equal((await hexa(['react', 'done'], { socket: a.socket })).code, 0);
  assert.equal((await hexa(['notify', '--title', 'Build', '--body', 'all green'], { socket: a.socket })).code, 0);
  assert.equal((await hexa(['notify', '--title=Only a title'], { socket: a.socket })).code, 0);
  assert.deepEqual(a.received.map((q) => [q.path, q.body]), [
    ['/cli/react', { reaction: 'done' }],
    ['/cli/notify', { title: 'Build', body: 'all green' }],
    ['/cli/notify', { title: 'Only a title' }],
  ]);
  await a.close();
});

test('Hexa not running: say, react and notify print a note and exit 0', async () => {
  for (const args of [['say', 'hi'], ['react', 'hello'], ['notify', '--title', 't']]) {
    const r = await hexa(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /isn't running/);
    assert.equal(r.stderr.trim().split('\n').length, 1);
  }
});

test('Hexa not running: status, sessions, show, hooks… exit 3', async () => {
  for (const args of [['status'], ['sessions'], ['show'], ['hide'], ['toggle'], ['demo'], ['hooks', 'status'], ['stats']]) {
    const r = await hexa(args);
    assert.equal(r.code, 3, args.join(' '));
    assert.match(r.stderr, /isn't running/);
  }
  const j = await hexa(['status', '--json']);
  assert.equal(j.code, 3);
  assert.deepEqual(JSON.parse(j.stdout), { ok: false, running: false, error: "Hexa isn't running" });
});

test('an error from Hexa: its message, exit 1', async () => {
  const a = await app(() => [400, { ok: false, error: 'nothing to say' }]);
  const r = await hexa(['say', 'x'], { socket: a.socket });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /nothing to say/);
  await a.close();
});

test('status: in words, or as JSON', async () => {
  const body = { ok: true, name: 'hexa', pid: 4242, visible: false, dnd: true, music: { playing: true, player: 'Spotify', title: 'Song', artist: 'Band' }, sessions: 2, hooks: { installed: true } };
  const a = await app(() => [200, body]);
  const r = await hexa(['status'], { socket: a.socket });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Hexa is running \(pid 4242\), in the background\./);
  assert.match(r.stdout, /Do Not Disturb: on/);
  assert.match(r.stdout, /Music: Song — Band \(Spotify\)/);
  assert.match(r.stdout, /sessions: 2/);
  const j = await hexa(['status', '--json'], { socket: a.socket });
  assert.deepEqual(JSON.parse(j.stdout), { running: true, ...body });
  assert.deepEqual(a.received.map((q) => [q.method, q.path]), [['GET', '/cli/status'], ['GET', '/cli/status']]);
  await a.close();
});

test('sessions: a table, or JSON', async () => {
  const sessions = [{ id: 's1', project: 'penguin-api', state: 'working', tool: 'Bash', started: Date.now() - 125000 }];
  const a = await app(() => [200, { ok: true, sessions }]);
  const r = await hexa(['sessions'], { socket: a.socket });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^penguin-api {2}working {2}Bash {2}2m\n$/);
  const j = await hexa(['sessions', '--json'], { socket: a.socket });
  assert.deepEqual(JSON.parse(j.stdout).sessions, sessions);
  await a.close();
});

test('stats asks for the range and prints what comes back', async () => {
  const a = await app(() => [200, { ok: true, tasks: 3, tokens: { total: 1200 } }]);
  const r = await hexa(['stats', '--week'], { socket: a.socket });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'tasks: 3\ntokens: {"total":1200}\n');
  await hexa(['stats'], { socket: a.socket });
  await hexa(['stats', '--month', '--json'], { socket: a.socket });
  assert.deepEqual(a.received.map((q) => [q.method, q.path, q.query.range]), [['GET', '/cli/stats', 'week'], ['GET', '/cli/stats', 'today'], ['GET', '/cli/stats', 'month']]);
  await a.close();
});

test('stats not built yet: the app’s 404 is passed on, exit 1', async () => {
  const a = await app(() => [404, { ok: false, error: 'unknown command "stats"' }]);
  const r = await hexa(['stats'], { socket: a.socket });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown command "stats"/);
  await a.close();
});

test('show, hide, toggle, demo, hooks', async () => {
  const a = await app((route, body) => (route === '/cli/hooks'
    ? [200, { ok: true, action: body.action, file: '/c/settings.json', events: 13 }]
    : [200, { ok: true, visible: true }]));
  for (const cmd of ['show', 'hide', 'toggle', 'demo']) {
    const r = await hexa([cmd], { socket: a.socket });
    assert.equal(r.code, 0, cmd);
    assert.equal(r.stdout, '', cmd);
  }
  const r = await hexa(['hooks', 'install'], { socket: a.socket });
  assert.match(r.stdout, /installed for 13 events in \/c\/settings.json/);
  await hexa(['hooks', 'uninstall', '--assistant', 'claude'], { socket: a.socket });
  assert.deepEqual(a.received.map((q) => [q.path, q.body]), [
    ['/cli/show', {}], ['/cli/hide', {}], ['/cli/toggle', {}], ['/cli/demo', {}],
    ['/cli/hooks', { action: 'install' }], ['/cli/hooks', { action: 'uninstall', assistant: 'claude' }],
  ]);
  await a.close();
});

test('run: tells her at the start and the end, keeps your terminal, exits with the command’s code', async () => {
  const a = await app();
  const r = await hexa(['run', '--', process.execPath, '-e', 'console.log("from the child"); process.exit(3)'], { socket: a.socket });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'from the child\n');
  assert.equal(r.stderr, '');
  const [start, end] = a.received;
  assert.equal(a.received.length, 2);
  assert.equal(start.path, '/cli/run-start');
  assert.equal(end.path, '/cli/run-end');
  assert.match(start.body.run_id, /^[a-f0-9]{16}$/);
  assert.equal(end.body.run_id, start.body.run_id);
  assert.ok(start.body.command.includes(`-e 'console.log("from the child"); process.exit(3)'`), start.body.command);
  assert.equal(start.body.cwd, process.cwd());
  assert.equal(end.body.code, 3);
  assert.equal(end.body.signal, null);
  assert.equal(typeof end.body.duration_ms, 'number');
  await a.close();
});

test('run: the -- is optional, and the command’s own options are left alone', async () => {
  const a = await app();
  try {
    const r = await hexa(['run', process.execPath, '-e', 'process.exit(process.argv.includes("--json") ? 0 : 1)', '--', '--json'], { socket: a.socket });
    assert.equal(r.code, 0);
    assert.equal(a.received[1].body.code, 0);
  } finally {
    await a.close();
  }
});

test('run: Hexa not running, the command still runs, with one short note', async () => {
  const r = await hexa(['run', '--', process.execPath, '-e', 'console.log("ran"); process.exit(5)']);
  assert.equal(r.code, 5);
  assert.equal(r.stdout, 'ran\n');
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /isn't running; running it anyway/);
});

test('run: a command that does not exist is 127, and she hears about it', async () => {
  const a = await app();
  const r = await hexa(['run', '--', '/nonexistent/hexa-test-command'], { socket: a.socket });
  assert.equal(r.code, 127);
  assert.match(r.stderr, /command not found/);
  assert.equal(a.received[1].body.code, 127);
  await a.close();
});

test('run: a signal that ends the command gives 128 + its number', async () => {
  const a = await app();
  const r = await hexa(['run', '--', process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'], { socket: a.socket });
  assert.equal(r.code, 143);
  assert.equal(a.received[1].body.code, null);
  assert.equal(a.received[1].body.signal, 'SIGTERM');
  await a.close();
});

test('run: a SIGTERM sent to hexa itself is passed on to the command', async () => {
  const a = await app();
  let sent = false;
  const r = await hexa(['run', '--', process.execPath, '-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    socket: a.socket,
    onStdout: (text, child) => {
      if (!sent && text.includes('ready')) {
        sent = true;
        child.kill('SIGTERM'); // the hexa process this test started
      }
    },
  });
  assert.equal(r.code, 143);
  assert.equal(a.received.at(-1).body.signal, 'SIGTERM');
  await a.close();
});

test('the CLI never sends an Origin header (the bridge would refuse it)', async () => {
  const a = await app();
  await hexa(['say', 'hi'], { socket: a.socket });
  assert.equal(a.received[0].origin, undefined);
  await a.close();
});

test('parse and requestFor, without a socket', () => {
  assert.deepEqual(parse(['run', '--', 'npm', 'test', '--', '-x']), { command: 'run', args: ['npm', 'test', '--', '-x'] });
  assert.deepEqual(requestFor(parse(['hooks', 'status'])), { method: 'POST', route: '/cli/hooks', body: { action: 'status' } });
  assert.deepEqual(requestFor(parse(['stats', '--today'])), { method: 'GET', route: '/cli/stats?range=today' });
  assert.throws(() => parse(['notify', '--title']), /needs a value/);
  assert.throws(() => parse(['status', '--json=yes']), /takes no value/);
});

test('display quotes what a shell would need quoted', () => {
  assert.equal(display(['npm', 'test']), 'npm test');
  assert.equal(display(['git', 'commit', '-m', "it's done"]), "git commit -m 'it'\\''s done'");
  assert.equal(display(['ls', '/a b']), "ls '/a b'");
});

test('describe: status without music or hooks, and no sessions', () => {
  assert.match(describeStatus({ visible: true, dnd: false, music: null, sessions: 0, hooks: { installed: false } }), /in front\.\nDo Not Disturb: off\nMusic: nothing\n.*\nHooks: not installed/);
  assert.match(describeStatus({ music: { playing: false, player: 'vlc', title: '', artist: '' } }), /Music: something \(vlc, paused\)/);
  assert.equal(describeSessions([]), 'No Claude Code sessions right now.');
});

test('end to end: the CLI, the real bridge and the app side', async () => {
  const { createBridge } = require('../src/main/bridge');
  const { createCli } = require('../src/main/cli');
  const socket = tempSocket();
  const sent = [];
  const cli = createCli({
    send: (channel, payload) => sent.push(payload),
    config: { load: () => ({ visible: true }) },
    actions: { toggle() {}, demo() {} },
    hooks: { status: () => ({ installed: false }) },
    stats: async ({ range }) => ({ range }),
  });
  const bridge = await createBridge({ socketPath: socket, onEvent() {}, onCli: cli.handle });
  try {
    assert.equal((await hexa(['say', 'hello', '--face', 'heart'], { socket })).code, 0);
    assert.equal((await hexa(['run', '--', process.execPath, '-e', 'process.exit(2)'], { socket })).code, 2);
    const status = await hexa(['status', '--json'], { socket });
    assert.equal(JSON.parse(status.stdout).running, true);
    assert.equal((await hexa(['stats', '--week'], { socket })).stdout, 'range: week\n');
    assert.equal((await hexa(['say', 'hi', '--face', 'NOT A FACE'], { socket })).code, 1);
    assert.deepEqual(sent.map((e) => [e.hook_event_name, e.phase || e.text]), [['HexaSay', 'hello'], ['HexaRun', 'start'], ['HexaRun', 'end']]);
    assert.equal(sent[2].code, 2);
  } finally {
    await bridge.close();
  }
});
