// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// Local bridge. Claude Code hooks (and the hexa CLI) talk to Hexa with HTTP over a Unix socket
// in your private runtime dir: only your user can connect, and no web page can reach it.
// An optional TCP port on 127.0.0.1 exists for tools that can't use a socket; it needs a token.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { ensurePrivateDir } = require('./paths');

const MAX_BODY = 512 * 1024;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

class TooLarge extends Error {}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = Number(req.headers['content-length']) || 0;
    if (size > MAX_BODY) return reject(new TooLarge('payload too large'));
    size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.removeAllListeners('data');
        req.resume(); // drain the rest so the 413 can still be read
        reject(new TooLarge('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function tokenMatches(given, token) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Is something answering on this socket? Resolves 'live', 'stale' (a leftover file) or 'none'.
function probe(socketPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve('none');
    const conn = net.connect(socketPath);
    conn.once('connect', () => {
      conn.destroy();
      resolve('live');
    });
    conn.once('error', () => resolve('stale'));
  });
}

function handler({ onEvent, onCli, onDebug, token }) {
  return async (req, res) => {
    // Browsers always send an Origin header on cross-site requests; hooks and the CLI never do.
    if (req.headers.origin) return send(res, 403, { ok: false });
    if (token && !tokenMatches(req.headers['x-hexa-token'], token)) return send(res, 401, { ok: false });

    const url = new URL(req.url, 'http://hexa');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, name: 'hexa', pid: process.pid });
      }

      if (req.method === 'POST' && url.pathname === '/event') {
        const evt = await readJson(req);
        if (!evt || typeof evt !== 'object' || typeof evt.hook_event_name !== 'string') {
          return send(res, 400, { ok: false, error: 'missing hook_event_name' });
        }
        onEvent(evt);
        return send(res, 200, { ok: true });
      }

      if (onCli && url.pathname.startsWith('/cli/')) {
        const body = req.method === 'POST' ? await readJson(req) : Object.fromEntries(url.searchParams);
        const out = await onCli(url.pathname.slice(5), body);
        return send(res, out?.status || 200, out?.body ?? { ok: true });
      }

      if (onDebug && url.pathname.startsWith('/debug/')) {
        const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
        return send(res, 200, await onDebug(url.pathname.slice(7), body));
      }

      return send(res, 404, { ok: false });
    } catch (err) {
      if (err instanceof TooLarge) {
        res.setHeader('connection', 'close');
        return send(res, 413, { ok: false, error: err.message });
      }
      return send(res, 400, { ok: false, error: err.message });
    }
  };
}

function listen(server, ...args) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(...args, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function createBridge({ socketPath, onEvent, onCli, onDebug, tcp = null }) {
  ensurePrivateDir(path.dirname(socketPath));
  const state = await probe(socketPath);
  if (state === 'live') throw new Error(`already running: another Hexa answers on ${socketPath}`);
  if (state === 'stale') fs.rmSync(socketPath, { force: true });

  const local = http.createServer(handler({ onEvent, onCli, onDebug }));
  await listen(local, socketPath);
  fs.chmodSync(socketPath, 0o600);

  let remote = null;
  if (tcp) {
    remote = http.createServer(handler({ onEvent, onCli, onDebug, token: tcp.token }));
    await listen(remote, tcp.port, '127.0.0.1');
  }

  const close = (server) => new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  return {
    socketPath,
    tcpPort: remote ? remote.address().port : null,
    async close() {
      await Promise.all([close(local), close(remote)]);
      fs.rmSync(socketPath, { force: true });
    },
  };
}

module.exports = { createBridge, MAX_BODY };
