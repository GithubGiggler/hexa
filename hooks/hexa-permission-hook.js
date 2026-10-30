#!/usr/bin/env node
'use strict';

// Claude Code PermissionRequest hook -> Hexa (opt-in: "Answer permissions from Hexa" in her menu).
// Asks Hexa over her socket and waits for your click on her card. Only an answer from her counts:
// anything else (she isn't running, no answer in time, you chose "Ask in Claude", a reply it can't
// read) prints nothing and exits 0, and Claude asks you in its own dialog as usual.
// This file is copied out of the app when the hook is installed, so it uses Node builtins only.

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Hexa answers within her own wait (60 s at most); past this, nobody is answering.
const WAIT_CAP_MS = 62000;
// Her card shows what you'd approve, whole: strings up to this long. Anything longer, or nested
// deeper, is cut and the request marked incomplete: then her card offers no Allow.
const MAX = 8000;

// Same rule as src/main/paths.js socketPath(), kept here so the hook stands alone.
function socketPath() {
  if (process.env.HEXA_SOCKET) return process.env.HEXA_SOCKET;
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime && path.isAbsolute(runtime)
    ? path.join(runtime, 'hexa', 'hexa.sock')
    : path.join(os.homedir(), '.cache', 'hexa', 'hexa.sock');
}

function cut(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
}

// The tool's input as her card will show it; state.cut is set when anything didn't fit.
function trim(value, state = { cut: false }, depth = 0) {
  if (typeof value === 'string') {
    if (value.length > MAX) state.cut = true;
    return cut(value, MAX);
  }
  if (Array.isArray(value)) {
    if (depth > 4 || value.length > 50) state.cut = true;
    return depth > 4 ? undefined : value.slice(0, 50).map((v) => trim(v, state, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth > 4) {
      state.cut = true;
      return undefined;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim(v, state, depth + 1);
    return out;
  }
  return value;
}

// The suggestion "Always allow" applies: the first that allows something, else none. Claude sent
// it; it goes back exactly as it came (updatedPermissions).
function pickAlways(suggestions) {
  if (!Array.isArray(suggestions)) return null;
  return suggestions.find((s) => s && typeof s === 'object' && (s.behavior === 'allow' || s.type === 'setMode' || s.type === 'addDirectories')) || null;
}

// What goes to Hexa: enough to say what Claude wants to do, and what "Always allow" would allow.
function buildRequest(evt) {
  const always = pickAlways(evt.permission_suggestions);
  const state = { cut: false };
  const req = {
    session_id: trim(evt.session_id),
    cwd: trim(evt.cwd),
    tool_name: trim(evt.tool_name, state),
    tool_input: trim(evt.tool_input, state),
    always: always ? trim(always, state) : null,
    ppid: process.ppid,
  };
  req.complete = !state.cut; // all of it is there to see
  return req;
}

// Her answer as the hook's output, or null for no decision.
function decide(answer, evt) {
  if (!answer || typeof answer !== 'object') return null;
  if (answer.behavior === 'allow') {
    const decision = { behavior: 'allow' };
    const always = answer.always ? pickAlways(evt.permission_suggestions) : null;
    if (always) decision.updatedPermissions = [always];
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  if (answer.behavior === 'deny') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from Hexa.' } } };
  }
  return null;
}

// An answer that allows things only counts from a socket you own, in a folder only you can open.
function trusted(sock) {
  try {
    const st = fs.lstatSync(sock);
    const dir = fs.statSync(require('node:path').dirname(sock));
    const me = process.getuid?.();
    return st.isSocket() && (me === undefined || (st.uid === me && dir.uid === me)) && (dir.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

function run() {
  const bail = () => process.exit(0);
  const timer = setTimeout(bail, WAIT_CAP_MS + 1000);
  timer.unref();

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8 * 1024 * 1024) bail();
  });
  process.stdin.on('error', bail);
  process.stdin.on('end', () => {
    let evt;
    try {
      evt = JSON.parse(raw);
      if (!evt || typeof evt !== 'object') return bail();
    } catch {
      return bail();
    }
    if (!trusted(socketPath())) return bail();
    const body = JSON.stringify(buildRequest(evt));
    const req = http.request({
      socketPath: socketPath(),
      path: '/permission',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: WAIT_CAP_MS,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let out = null;
        try {
          out = res.statusCode === 200 ? decide(JSON.parse(text), evt) : null;
        } catch {
          out = null;
        }
        if (out) process.stdout.write(JSON.stringify(out));
        bail();
      });
    });
    req.on('timeout', () => { req.destroy(); bail(); });
    req.on('error', bail);
    req.end(body);
  });
}

module.exports = { run, buildRequest, decide, pickAlways, socketPath, trusted, WAIT_CAP_MS };
if (require.main === module) run();
