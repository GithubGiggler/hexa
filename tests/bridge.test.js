'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createBridge } = require('../src/main/bridge');

function tempSocket() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-br-')), 'run', 'hexa.sock');
}

// One request; resolves { status, body } with body parsed as JSON when it can be.
function request(target, { method = 'GET', path: p = '/', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      ...(target.socketPath ? { socketPath: target.socketPath } : { host: '127.0.0.1', port: target.port }),
      path: p,
      method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function withBridge(opts, fn) {
  const socketPath = opts.socketPath || tempSocket();
  const bridge = await createBridge({ socketPath, onEvent: () => {}, ...opts });
  try {
    await fn({ socketPath, bridge });
  } finally {
    await bridge.close();
  }
}

test('health', async () => {
  await withBridge({}, async ({ socketPath }) => {
    const r = await request({ socketPath }, { path: '/health' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.name, 'hexa');
    assert.equal(r.body.pid, process.pid);
  });
});

test('event reaches onEvent', async () => {
  const seen = [];
  await withBridge({ onEvent: (e) => seen.push(e) }, async ({ socketPath }) => {
    const r = await request({ socketPath }, { method: 'POST', path: '/event', body: { hook_event_name: 'Stop' } });
    assert.equal(r.status, 200);
    assert.deepEqual(seen, [{ hook_event_name: 'Stop' }]);
  });
});

test('missing hook_event_name is 400', async () => {
  await withBridge({}, async ({ socketPath }) => {
    const r = await request({ socketPath }, { method: 'POST', path: '/event', body: { nope: 1 } });
    assert.equal(r.status, 400);
  });
});

test('body over 512 KB is 413', async () => {
  await withBridge({}, async ({ socketPath }) => {
    const big = JSON.stringify({ hook_event_name: 'Stop', pad: 'x'.repeat(600 * 1024) });
    const r = await request({ socketPath }, { method: 'POST', path: '/event', body: big });
    assert.equal(r.status, 413);
    // and the bridge still answers afterwards
    assert.equal((await request({ socketPath }, { path: '/health' })).status, 200);
  });
});

test('Origin header is 403', async () => {
  await withBridge({}, async ({ socketPath }) => {
    const r = await request({ socketPath }, { path: '/health', headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });
});

test('socket 0600 in a 0700 dir', async () => {
  await withBridge({}, async ({ socketPath }) => {
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700);
  });
});

test('stale socket file is replaced', async () => {
  const socketPath = tempSocket();
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  // a socket left behind by a crashed instance: bound once, then its server gone
  const dead = net.createServer();
  await new Promise((r) => dead.listen(socketPath, r));
  await new Promise((r) => { dead.close(r); });
  if (!fs.existsSync(socketPath)) fs.writeFileSync(socketPath, ''); // some kernels unlink on close
  await withBridge({ socketPath }, async () => {
    const r = await request({ socketPath }, { path: '/health' });
    assert.equal(r.status, 200);
  });
});

test('a live bridge is not stolen', async () => {
  await withBridge({}, async ({ socketPath }) => {
    await assert.rejects(createBridge({ socketPath, onEvent: () => {} }), /already running/);
    const r = await request({ socketPath }, { path: '/health' });
    assert.equal(r.status, 200);
  });
});

test('debug routes 404 without onDebug, answer with it', async () => {
  await withBridge({}, async ({ socketPath }) => {
    assert.equal((await request({ socketPath }, { path: '/debug/state' })).status, 404);
  });
  await withBridge({ onDebug: async (name) => ({ ok: true, name }) }, async ({ socketPath }) => {
    const r = await request({ socketPath }, { path: '/debug/state' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'state');
  });
});

test('cli routes go to onCli', async () => {
  await withBridge({ onCli: async (cmd, body) => ({ body: { ok: true, cmd, body } }) }, async ({ socketPath }) => {
    const r = await request({ socketPath }, { method: 'POST', path: '/cli/say', body: { text: 'hi' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, cmd: 'say', body: { text: 'hi' } });
  });
  await withBridge({}, async ({ socketPath }) => {
    assert.equal((await request({ socketPath }, { path: '/cli/status' })).status, 404);
  });
});

test('tcp needs the token', async () => {
  await withBridge({ tcp: { port: 0, token: 't0ken' } }, async ({ bridge }) => {
    const target = { port: bridge.tcpPort };
    assert.equal((await request(target, { path: '/health' })).status, 401);
    assert.equal((await request(target, { path: '/health', headers: { 'x-hexa-token': 'wrong' } })).status, 401);
    assert.equal((await request(target, { path: '/health', headers: { 'x-hexa-token': 't0ken' } })).status, 200);
    assert.equal((await request(target, { path: '/health', headers: { 'x-hexa-token': 't0ken', origin: 'http://x' } })).status, 403);
  });
});

test('/permission waits for onPermission, on the Unix socket only', async () => {
  let asked = null;
  const onPermission = async (ask) => { asked = ask; await new Promise((r) => setTimeout(r, 50)); return { behavior: 'allow' }; };
  await withBridge({ onPermission, tcp: { port: 0, token: 't' } }, async ({ socketPath, bridge }) => {
    const r = await request({ socketPath }, { method: 'POST', path: '/permission', body: { tool_name: 'Bash' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { behavior: 'allow' });
    assert.equal(asked.tool_name, 'Bash');
    const tcp = await request({ port: bridge.tcpPort }, { method: 'POST', path: '/permission', body: { tool_name: 'Bash' }, headers: { 'x-hexa-token': 't' } });
    assert.equal(tcp.status, 404, 'nothing over TCP can ask (or answer)');
  });
});

test('/permission: a hook that hangs up first is heard through onClose', async () => {
  let closed = false;
  let finish;
  const onPermission = (ask, { onClose }) => new Promise((resolve) => {
    finish = resolve;
    onClose(() => { closed = true; resolve(null); });
  });
  await withBridge({ onPermission }, async ({ socketPath }) => {
    await new Promise((resolve) => {
      const data = JSON.stringify({ tool_name: 'Bash' });
      const req = http.request({ socketPath, path: '/permission', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } });
      req.on('error', () => {});
      req.end(data);
      setTimeout(() => { req.destroy(); setTimeout(resolve, 100); }, 100);
    });
    assert.equal(closed, true);
    finish?.(null);
  });
});
