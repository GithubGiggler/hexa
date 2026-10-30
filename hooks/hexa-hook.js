#!/usr/bin/env node
// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// Claude Code hook -> Hexa.
// Reads the hook event on stdin and forwards a trimmed copy to the Hexa app over its Unix socket.
// Rule #1: never get in Claude's way. No output, always exit 0, give up fast.
// This file is copied out of the app when the hooks are installed, so it uses Node builtins only.
// The Codex and Antigravity hooks (hexa-codex-hook.js, hexa-agy-hook.js) are copied next to it and
// run(adapt) through it: their adapter turns their event into one shaped like Claude's.

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Same rule as src/main/paths.js socketPath(), kept here so the hook stands alone.
function socketPath() {
  if (process.env.HEXA_SOCKET) return process.env.HEXA_SOCKET;
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime && path.isAbsolute(runtime)
    ? path.join(runtime, 'hexa', 'hexa.sock')
    : path.join(os.homedir(), '.cache', 'hexa', 'hexa.sock');
}

// Fields Hexa actually uses. Everything else (file contents, tool output...) stays on your machine.
const KEEP = [
  'hook_event_name', 'session_id', 'cwd', 'session_title', 'permission_mode', 'transcript_path', 'agent_transcript_path',
  'tool_name', 'tool_input', 'tool_use_id', 'duration_ms', 'error', 'is_interrupt',
  'prompt', 'message', 'title', 'notification_type', 'last_assistant_message',
  'agent_id', 'agent_type', 'source', 'reason', 'trigger',
];

const MAX = 280;

// Cuts text to max characters without leaving half of a surrogate pair (emoji, rare scripts).
function cut(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
}

function trim(value, depth = 0) {
  if (typeof value === 'string') return cut(value, MAX);
  if (Array.isArray(value)) return depth > 2 ? undefined : value.slice(0, 8).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 2) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // big edit payloads are useless to Hexa, keep only their size
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(k)) {
        out[k + '_len'] = typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : 0;
        continue;
      }
      out[k] = trim(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Claude's answer, long enough for Hexa to show it to you when you're not on Claude's window
const REPLY_MAX = 6000;
const PATH_MAX = 4096;

// assistant: whose hook this is ('claude', 'codex', 'agy'); the event can't say so itself.
function slim(evt, { assistant = 'claude' } = {}) {
  const out = {};
  for (const key of KEEP) if (evt[key] !== undefined) out[key] = trim(evt[key]);
  const reply = evt.last_assistant_message;
  if (typeof reply === 'string') out.last_assistant_message = cut(reply, REPLY_MAX);
  // transcripts are where Hexa reads token counts: their paths must arrive whole
  for (const key of ['transcript_path', 'agent_transcript_path']) {
    if (typeof evt[key] === 'string' && evt[key].length <= PATH_MAX) out[key] = evt[key];
  }
  // the process that ran this hook: Hexa walks up from it to find the terminal Claude lives in
  out.ppid = process.ppid;
  out.assistant = assistant;
  return out;
}

// adapt(event): the event as Hexa should see it, or null to send nothing. reply: what to print on
// stdout before anything else, for an assistant that wants an answer from every hook (Antigravity's
// "{}": carry on as usual); Claude and Codex get nothing.
function run(adapt = (evt) => evt, { assistant = 'claude', reply = '' } = {}) {
  if (reply) {
    process.stdout.on('error', () => {}); // a closed pipe (EPIPE) mustn't turn into a crash
    try {
      process.stdout.write(reply); // a pipe: written at once on Linux, before any exit below
    } catch {
      // nobody reading: nothing to tell
    }
  }
  const bail = () => process.exit(0);
  setTimeout(bail, 2000).unref();

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
      evt = adapt(JSON.parse(raw));
      if (!evt || typeof evt !== 'object') return bail();
    } catch {
      return bail();
    }
    const body = JSON.stringify(slim(evt, { assistant }));
    const req = http.request({
      socketPath: socketPath(),
      path: '/event',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: 800,
    }, (res) => {
      res.resume();
      res.on('end', bail);
    });
    req.on('timeout', () => { req.destroy(); bail(); });
    req.on('error', bail);
    req.end(body);
  });
}

module.exports = { run, slim, trim, socketPath, KEEP };
if (require.main === module) run();
