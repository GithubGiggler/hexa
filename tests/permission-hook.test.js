'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildRequest, decide, pickAlways } = require('../hooks/hexa-permission-hook');

const HOOK = path.join(__dirname, '..', 'hooks', 'hexa-permission-hook.js');
const SUGGESTION = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
const INPUT = {
  hook_event_name: 'PermissionRequest', session_id: 's1', cwd: '/home/u/projects/penguin-api',
  tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' }, permission_suggestions: [SUGGESTION],
};

function invoke(input, env = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (s) => { stdout += s; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - started }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

// a stand-in for Hexa: answers /permission with `answer` (or raw text)
function fakeHexa(answer, { status = 200 } = {}) {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-perm-')), 'hexa.sock');
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, body: JSON.parse(body) });
      res.statusCode = status;
      res.end(typeof answer === 'string' ? answer : JSON.stringify(answer));
    });
  });
  return new Promise((resolve) => server.listen(sock, () => resolve({ sock, server, received })));
}

test('Hexa not running: no output, exit 0, at once (Claude asks as usual)', async () => {
  const r = await invoke(INPUT, { HEXA_SOCKET: '/nonexistent/x.sock' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 2000, `${r.ms} ms`);
});

test('Allow from her becomes the allow decision', async () => {
  const { sock, server, received } = await fakeHexa({ behavior: 'allow' });
  const r = await invoke(INPUT, { HEXA_SOCKET: sock });
  server.close();
  assert.equal(received[0].path, '/permission');
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
});

test('Always allow sends back the suggestion exactly as Claude sent it', async () => {
  const { sock, server } = await fakeHexa({ behavior: 'allow', always: true });
  const r = await invoke(INPUT, { HEXA_SOCKET: sock });
  server.close();
  assert.deepEqual(JSON.parse(r.stdout).hookSpecificOutput.decision.updatedPermissions, [SUGGESTION]);
});

test('Deny from her becomes a deny with a message', async () => {
  const { sock, server } = await fakeHexa({ behavior: 'deny' });
  const r = await invoke(INPUT, { HEXA_SOCKET: sock });
  server.close();
  assert.deepEqual(JSON.parse(r.stdout).hookSpecificOutput.decision, { behavior: 'deny', message: 'Denied from Hexa.' });
});

test('no decision, a broken reply or an error status: no output', async () => {
  for (const [answer, opts] of [[{ behavior: null }, {}], ['{nope', {}], [{ behavior: 'allow' }, { status: 403 }], [{ behavior: 'maybe' }, {}]]) {
    const { sock, server } = await fakeHexa(answer, opts);
    const r = await invoke(INPUT, { HEXA_SOCKET: sock });
    server.close();
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', JSON.stringify(answer));
  }
});

test('what she is sent: what Always allow would allow, and when it\'s too long to show whole', () => {
  const req = buildRequest({ ...INPUT, tool_name: 'Write', tool_input: { file_path: '/p/a.ts', content: 'x'.repeat(10000) } });
  assert.equal(req.tool_input.file_path, '/p/a.ts');
  assert.equal(req.complete, false, 'too long to show whole: no Allow');
  assert.deepEqual(req.always, SUGGESTION);
  assert.equal(typeof req.ppid, 'number');
  assert.equal(pickAlways([{ type: 'addRules', behavior: 'deny', rules: [] }]), null, 'never a deny rule as "always allow"');
  assert.equal(decide({ behavior: 'allow', always: true }, { permission_suggestions: [] }).hookSpecificOutput.decision.updatedPermissions, undefined);
});

test('she\'s sent the whole thing, and told when anything had to be cut', () => {
  const long = 'x'.repeat(9000);
  const full = buildRequest({ ...INPUT, tool_input: { command: 'npm test -- --watch=false', description: 'Run the unit tests' } });
  assert.equal(full.complete, true);
  assert.equal(full.tool_input.command, 'npm test -- --watch=false');
  const cut = buildRequest({ ...INPUT, tool_input: { command: `npm test ${long}` } });
  assert.equal(cut.complete, false);
  const write = buildRequest({ ...INPUT, tool_name: 'Write', tool_input: { file_path: '/p/a.sh', content: 'rm -rf ~\n' } });
  assert.equal(write.tool_input.content, 'rm -rf ~\n', 'what would be written, so you can see it');
  assert.equal(write.complete, true);
});
