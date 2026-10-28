'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { slim, trim, socketPath, KEEP } = require('../hooks/hexa-hook');

const HOOK = path.join(__dirname, '..', 'hooks', 'hexa-hook.js');

function tempSocket() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-hook-')), 'hexa.sock');
}

// Runs the hook as Claude Code would: event JSON on stdin. Resolves { code, stdout, stderr, ms }.
function invoke(input, env = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (s) => { stdout += s; });
    child.stderr.on('data', (s) => { stderr += s; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(input);
  });
}

// A stand-in for the app: records every request on a Unix socket.
function listen(sock) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, body: JSON.parse(body) });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => server.listen(sock, () => resolve({ server, received })));
}

test('keeps only the fields Hexa uses, plus transcript_path, ppid and the assistant', () => {
  const out = slim({ hook_event_name: 'Stop', transcript_path: '/t.jsonl', session_id: 's', junk: 1 });
  assert.equal(out.transcript_path, '/t.jsonl');
  assert.equal(out.session_id, 's');
  assert.equal(typeof out.ppid, 'number');
  assert.equal(out.assistant, 'claude');
  assert.equal(out.junk, undefined);
  assert.ok(KEEP.includes('transcript_path'));
});

test('long strings are cut at 280 with an ellipsis', () => {
  const s = trim('a'.repeat(500));
  assert.equal(s, 'a'.repeat(280) + '…');
  assert.equal(trim('short'), 'short');
});

test('never splits a surrogate pair', () => {
  const s = trim('😀'.repeat(300));
  assert.ok(!/[\uD800-\uDBFF]…$/.test(s), 'ends on a lone high surrogate');
  assert.ok(s.endsWith('😀…'));
});

test('file contents become lengths', () => {
  const out = slim({
    hook_event_name: 'PreToolUse',
    tool_input: { file_path: '/a', content: 'x'.repeat(5000), old_string: 'ab', new_string: 'abc', edits: [1, 2] },
  });
  assert.equal(out.tool_input.file_path, '/a');
  assert.equal(out.tool_input.content_len, 5000);
  assert.equal(out.tool_input.old_string_len, 2);
  assert.equal(out.tool_input.new_string_len, 3);
  assert.equal(out.tool_input.edits_len, 2);
  assert.equal(out.tool_input.content, undefined);
});

test('arrays are capped at 8 and deep nesting is dropped', () => {
  const out = slim({ hook_event_name: 'PreToolUse', tool_input: { list: Array.from({ length: 20 }, (_, i) => i), a: { b: { c: { d: 1 } } } } });
  assert.equal(out.tool_input.list.length, 8);
  assert.equal(out.tool_input.a.b.c, undefined);
});

test('last reply capped at 6000', () => {
  const out = slim({ hook_event_name: 'Stop', last_assistant_message: 'a'.repeat(9000) });
  assert.equal(out.last_assistant_message.length, 6001);
});

test('socketPath follows HEXA_SOCKET, then XDG_RUNTIME_DIR', () => {
  const saved = { s: process.env.HEXA_SOCKET, r: process.env.XDG_RUNTIME_DIR };
  process.env.HEXA_SOCKET = '/tmp/a.sock';
  assert.equal(socketPath(), '/tmp/a.sock');
  delete process.env.HEXA_SOCKET;
  process.env.XDG_RUNTIME_DIR = '/run/user/1000';
  assert.equal(socketPath(), '/run/user/1000/hexa/hexa.sock');
  if (saved.s === undefined) delete process.env.HEXA_SOCKET; else process.env.HEXA_SOCKET = saved.s;
  if (saved.r === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved.r;
});

test('no app running: exits 0 fast and prints nothing', async () => {
  const r = await invoke('{"hook_event_name":"Stop"}', { HEXA_SOCKET: '/nonexistent/dir/x.sock' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.ok(r.ms < 2500, `took ${r.ms} ms`);
});

test('invalid stdin: exits 0 without posting', async () => {
  const sock = tempSocket();
  const { server, received } = await listen(sock);
  const r = await invoke('{not json', { HEXA_SOCKET: sock });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(received.length, 0);
});

test('posts the slimmed event to the socket', async () => {
  const sock = tempSocket();
  const { server, received } = await listen(sock);
  const r = await invoke(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } }), { HEXA_SOCKET: sock });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(received.length, 1);
  assert.equal(received[0].path, '/event');
  assert.equal(received[0].body.hook_event_name, 'PreToolUse');
  assert.equal(typeof received[0].body.ppid, 'number');
});
