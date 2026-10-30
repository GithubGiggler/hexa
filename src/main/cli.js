'use strict';

// The app side of the hexa CLI (bin/hexa.js): what arrives on /cli/<command> over the bridge.
// Every input is checked and capped here; anything unexpected is a 400 and does nothing.
//
// Nothing here can approve a permission (spec §7.1): no command reaches a permission request, and
// the events below are built from scratch, so a request body can't pass itself off as Claude's.
//
// What the renderer gets on 'hexa:event', shaped like hook events so it can treat them alike:
//   { hook_event_name: 'HexaSay',   assistant: 'cli', session_id: 'cli', text, face? }
//       text: one line, at most 280 characters; face: a glyph name (calm, laugh, ...), unchecked
//       against the pack (an unknown one shows as calm)
//   { hook_event_name: 'HexaReact', assistant: 'cli', session_id: 'cli', reaction }
//       reaction: 'done' | 'error' | 'alert' | 'hello' | 'fork'
//   { hook_event_name: 'HexaRun',   assistant: 'cli', session_id: 'cli', phase: 'start', run_id, command, cwd? }
//   { hook_event_name: 'HexaRun',   assistant: 'cli', session_id: 'cli', phase: 'end', run_id, command, cwd?,
//     code, signal, duration_ms, ok }
//       `hexa run -- <command…>`: the ticker shows "RUNS <command>" from start to end; code is the exit
//       code (null when a signal ended it), signal like 'SIGTERM' or null, ok is code === 0

const path = require('node:path');
const { clean } = require('./text');
const { ASSISTANTS, assistantOf } = require('./hooks');

const REACTIONS = new Set(['done', 'error', 'alert', 'hello', 'fork']);
const FACE = /^[a-z][a-z0-9-]{0,23}$/;
const RUN_ID = /^[a-f0-9]{8,32}$/;
const SIGNAL = /^SIG[A-Z0-9]{1,12}$/;
const MAX_SAY = 280;
const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_COMMAND = 200;
const MAX_CWD = 1024;
const MAX_DURATION = 30 * 24 * 3600 * 1000;
const RANGES = new Set(['today', 'week', 'month']);

const ok = (body = {}) => ({ status: 200, body: { ok: true, ...body } });
const bad = (error) => ({ status: 400, body: { ok: false, error } });
const failed = (error) => ({ status: 500, body: { ok: false, error } });

const cwdOf = (value) => {
  const cwd = clean(value, MAX_CWD);
  return cwd && path.isAbsolute(cwd) ? cwd : undefined;
};

// send(channel, payload): to the renderer. config: { load() }. actions: the tray's (toggle, demo).
// sessions(): what main knows of each session (createSessionList below). notify: notifications.js's.
// hooks: { install, uninstall, status }, each called with the assistant ('claude', 'codex' or 'agy').
// linux(): { dnd, music }. stats(query): body for `hexa stats`,
// when someone has built it.
function createCli({ send, config, actions, sessions = () => [], notify = async () => null, hooks, linux = () => ({ dnd: false, music: null }), stats = null, version = '' }) {
  const event = (fields) => send('hexa:event', { assistant: 'cli', session_id: 'cli', ...fields });
  const visible = () => config.load().visible !== false;

  const run = (phase, body) => {
    if (typeof body.run_id !== 'string' || !RUN_ID.test(body.run_id)) return bad('run_id must be 8 to 32 hex digits');
    const command = clean(body.command, MAX_COMMAND);
    if (!command) return bad('command is missing');
    const fields = { hook_event_name: 'HexaRun', phase, run_id: body.run_id, command };
    const cwd = cwdOf(body.cwd);
    if (cwd) fields.cwd = cwd;
    if (phase === 'end') {
      const code = body.code ?? null;
      const signal = body.signal ?? null;
      if (code !== null && !(Number.isInteger(code) && code >= 0 && code <= 255)) return bad('code must be 0 to 255, or null');
      if (signal !== null && !(typeof signal === 'string' && SIGNAL.test(signal))) return bad('signal must look like SIGTERM, or be null');
      const ms = Number(body.duration_ms);
      Object.assign(fields, {
        code,
        signal,
        duration_ms: Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), MAX_DURATION) : null,
        ok: code === 0,
      });
    }
    event(fields);
    return ok();
  };

  const commands = {
    say(body) {
      const text = clean(body.text, MAX_SAY);
      if (!text) return bad('nothing to say');
      const fields = { hook_event_name: 'HexaSay', text };
      if (body.face !== undefined && body.face !== null && body.face !== '') {
        if (typeof body.face !== 'string' || !FACE.test(body.face)) return bad('a face is a glyph name, like calm or laugh');
        fields.face = body.face;
      }
      event(fields);
      return ok();
    },

    react(body) {
      if (!REACTIONS.has(body.reaction)) return bad(`reaction must be one of ${[...REACTIONS].join(', ')}`);
      event({ hook_event_name: 'HexaReact', reaction: body.reaction });
      return ok();
    },

    async notify(body) {
      const title = clean(body.title, MAX_TITLE);
      if (!title) return bad('a notification needs a title');
      const id = await notify({ title, body: clean(body.body, MAX_BODY, { lines: true }) });
      return ok({ id: id ?? null });
    },

    'run-start': (body) => run('start', body),
    'run-end': (body) => run('end', body),

    status() {
      const { dnd = false, music = null } = linux() || {};
      // the hooks of the assistant she watches
      const assistant = assistantOf(config.load().assistant) || 'claude';
      const h = hooks?.status?.(assistant) || {};
      return ok({
        name: 'hexa',
        version,
        pid: process.pid,
        visible: visible(),
        dnd: Boolean(dnd),
        music,
        sessions: sessions().filter((s) => (s.assistant || 'claude') === assistant).length, // the watched one's
        assistant,
        hooks: { installed: Boolean(h.installed), ...(h.error ? { error: h.error } : {}), ...(h.warning ? { warning: h.warning } : {}) },
      });
    },

    sessions() {
      return ok({ sessions: sessions() });
    },

    show() {
      if (!visible()) actions.toggle();
      return ok({ visible: visible() });
    },
    hide() {
      if (visible()) actions.toggle();
      return ok({ visible: visible() });
    },
    toggle() {
      actions.toggle();
      return ok({ visible: visible() });
    },

    demo() {
      actions.demo();
      return ok();
    },

    hooks(body) {
      const assistant = assistantOf(body.assistant ?? 'claude');
      if (!assistant) return bad(`hooks for "${clean(String(body.assistant), 20)}" aren't supported (only ${ASSISTANTS.join(', ')})`);
      const what = body.action;
      if (!['install', 'uninstall', 'status'].includes(what) || typeof hooks?.[what] !== 'function') {
        return bad('hooks takes install, uninstall or status');
      }
      try {
        const r = hooks[what](assistant) || {};
        if (r.ok === false) return failed(r.error || `could not ${what} the hooks`);
        const { ok: _ok, ...rest } = r;
        return ok({ action: what, ...rest });
      } catch (err) {
        return failed(err.message);
      }
    },

    async stats(body) {
      if (typeof stats !== 'function') return { status: 404, body: { ok: false, error: 'stats aren’t available in this version of Hexa' } };
      const range = body.range ?? 'today';
      if (!RANGES.has(range)) return bad('range must be today, week or month');
      try {
        const out = await stats({ range });
        if (out && typeof out.status === 'number') return out; // already { status, body }
        return ok(out && typeof out === 'object' ? out : { value: out });
      } catch (err) {
        return failed(err.message);
      }
    },
  };

  async function handle(cmd, body) {
    if (typeof cmd !== 'string' || !Object.hasOwn(commands, cmd)) {
      return { status: 404, body: { ok: false, error: `unknown command "${clean(String(cmd), 40)}"` } };
    }
    if (body === undefined) body = {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('the request body must be a JSON object');
    return commands[cmd](body);
  }

  return { handle };
}

// What `hexa status` and `hexa sessions` know: each Claude session, from the events main forwards.
// The renderer keeps its own, richer record; this one only has to answer the CLI.
const STALE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 64;
const ALERTS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

function stateAfter(evt, previous) {
  switch (evt.hook_event_name) {
    case 'SessionStart': return 'idle';
    case 'UserPromptSubmit': case 'PreToolUse': case 'PostToolUse': case 'SubagentStart': case 'SubagentStop': case 'PreCompact':
      return 'working';
    case 'PostToolUseFailure': return evt.is_interrupt ? 'idle' : 'error';
    case 'StopFailure': return 'error';
    case 'Stop': return 'done';
    case 'Notification': return ALERTS.has(evt.notification_type) ? 'waiting' : previous;
    default: return previous;
  }
}

function createSessionList({ now = Date.now } = {}) {
  const sessions = new Map();

  function see(evt) {
    if (!evt || evt.demo || evt.assistant === 'cli' || typeof evt.hook_event_name !== 'string') return;
    const id = clean(typeof evt.session_id === 'string' ? evt.session_id : 'default', 80) || 'default';
    if (evt.hook_event_name === 'SessionEnd') {
      sessions.delete(id);
      return;
    }
    let s = sessions.get(id);
    if (!s) {
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.seen - b.seen)[0];
        sessions.delete(oldest.id);
      }
      s = { id, assistant: 'claude', project: '', cwd: '', title: '', state: 'idle', tool: '', started: now(), seen: now(), events: 0 };
      sessions.set(id, s);
    }
    if (typeof evt.assistant === 'string') s.assistant = clean(evt.assistant, 20);
    const cwd = cwdOf(evt.cwd);
    if (cwd) {
      s.cwd = cwd;
      s.project = path.basename(cwd);
    }
    if (typeof evt.session_title === 'string') s.title = clean(evt.session_title, 80);
    if (evt.hook_event_name === 'PreToolUse' && typeof evt.tool_name === 'string') s.tool = clean(evt.tool_name, 60);
    if (evt.hook_event_name === 'Stop' || evt.hook_event_name === 'UserPromptSubmit') s.tool = '';
    s.state = stateAfter(evt, s.state);
    s.seen = now();
    s.events += 1;
  }

  // Live sessions, the most recently active first. Quiet for 30 minutes: gone (no SessionEnd ever came).
  function list() {
    const cutoff = now() - STALE_MS;
    for (const [id, s] of sessions) if (s.seen < cutoff) sessions.delete(id);
    return [...sessions.values()].sort((a, b) => b.seen - a.seen).map((s) => ({ ...s }));
  }

  return { see, list };
}

module.exports = { createCli, createSessionList, REACTIONS };
