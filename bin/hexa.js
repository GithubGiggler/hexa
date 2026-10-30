#!/usr/bin/env node
'use strict';

// hexa: talk to Hexa from your shell. Every command goes to the app over its Unix socket, the same
// one her Claude Code hook uses (src/main/cli.js answers). Node builtins only, so it runs wherever
// node does. Nothing here can approve a permission: the app offers no such command.

const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EXIT = { ok: 0, failed: 1, usage: 2, away: 3 };
const REACTIONS = ['done', 'error', 'alert', 'hello', 'fork'];

const HELP = `Usage: hexa <command> [options]

Talk to Hexa, your desktop companion, from the shell.

  say <text…> [--face <glyph>]       she says it. Faces: calm, smug, wide, laugh, squint, sleepy,
                                     angry, dizzy, heart, loading, ask, dead
  react done|error|alert|hello|fork  she reacts
  notify --title <t> [--body <b>]    a desktop notification from her
  run -- <command…>                  runs the command right here; her ticker shows RUNS <command>
                                     while it runs, and she reacts to how it ended
  status [--json]                    is she running, in front or in the background, Do Not
                                     Disturb, what's playing
  sessions [--json]                  the Claude Code sessions she's following
  stats [--today|--week|--month] [--json]
  show | hide | toggle               bring her back, send her to the background, or flip it
  demo                               play the demo
  hooks install|uninstall|status [--assistant claude|codex|agy]
                                     her hooks: Claude Code's in ~/.claude/settings.json (the
                                     default), the Codex CLI's in ~/.codex/hooks.json, or
                                     Antigravity's (agy) in ~/.gemini/config/hooks.json

Exit codes:
  0  done. say, react and notify also exit 0 when Hexa isn't running, after a note on stderr,
     so a script doesn't fail just because she's not there
  1  Hexa answered with an error
  2  wrong usage
  3  Hexa isn't running (status, sessions, stats, show, hide, toggle, demo, hooks)
  run exits with the command's own code (128 + the signal's number when a signal ended it,
  127 when it could not be found). It runs whether Hexa is there or not.

Environment:
  HEXA_SOCKET  the socket to talk to (default: $XDG_RUNTIME_DIR/hexa/hexa.sock)
`;

class Usage extends Error {}

// The assistants she has hooks for (src/main/hooks/index.js), and what each is called.
const ASSISTANTS = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };
const ALIASES = { 'claude-code': 'claude', antigravity: 'agy', 'codex-cli': 'codex' };
const assistantOf = (value) => {
  const name = String(value).trim().toLowerCase();
  const id = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return Object.hasOwn(ASSISTANTS, id) ? id : null;
};

// Same rule as src/main/paths.js socketPath(), kept here so the CLI stands alone.
function socketPath() {
  if (process.env.HEXA_SOCKET) return process.env.HEXA_SOCKET;
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime && path.isAbsolute(runtime)
    ? path.join(runtime, 'hexa', 'hexa.sock')
    : path.join(os.homedir(), '.cache', 'hexa', 'hexa.sock');
}

// The options each command takes: true when it needs a value, false for a switch.
const OPTIONS = {
  say: { face: true },
  react: {},
  notify: { title: true, body: true },
  status: { json: false },
  sessions: { json: false },
  stats: { today: false, week: false, month: false, json: false },
  show: {},
  hide: {},
  toggle: {},
  demo: {},
  hooks: { assistant: true },
};

function parse(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) throw new Usage('');
  if (['--help', '-h', 'help'].includes(command)) return { command: 'help' };
  if (['--version', '-V', 'version'].includes(command)) return { command: 'version' };
  if (command === 'run') {
    // everything after `run` (and its optional --) is the command, options and all
    const args = rest[0] === '--' ? rest.slice(1) : rest;
    if (!args.length) throw new Usage('run needs a command: hexa run -- <command…>');
    return { command, args };
  }
  if (!Object.hasOwn(OPTIONS, command)) throw new Usage(`unknown command "${command}"`);
  const takes = OPTIONS[command];
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') {
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') return { command: 'help' };
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (!Object.hasOwn(takes, name)) throw new Usage(`${command} doesn't take --${name}`);
    if (takes[name]) {
      const value = eq === -1 ? rest[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new Usage(`--${name} needs a value`);
      flags[name] = value;
    } else {
      if (eq !== -1) throw new Usage(`--${name} takes no value`);
      flags[name] = true;
    }
  }
  return { command, flags, positional };
}

// What to ask Hexa for: { method, route, body }.
function requestFor({ command, flags, positional }) {
  const none = () => {
    if (positional.length) throw new Usage(`${command} takes no arguments`);
  };
  switch (command) {
    case 'say': {
      const text = positional.join(' ');
      if (!text.trim()) throw new Usage('say what? hexa say <text…>');
      return { method: 'POST', route: '/cli/say', body: { text, ...(flags.face ? { face: flags.face } : {}) } };
    }
    case 'react':
      if (positional.length !== 1 || !REACTIONS.includes(positional[0])) throw new Usage(`react takes one of ${REACTIONS.join(', ')}`);
      return { method: 'POST', route: '/cli/react', body: { reaction: positional[0] } };
    case 'notify':
      if (positional.length) throw new Usage('notify takes --title <t> and --body <b>');
      if (!flags.title || !flags.title.trim()) throw new Usage('notify needs --title <t>');
      return { method: 'POST', route: '/cli/notify', body: { title: flags.title, ...(flags.body !== undefined ? { body: flags.body } : {}) } };
    case 'status':
    case 'sessions':
      none();
      return { method: 'GET', route: `/cli/${command}` };
    case 'stats': {
      none();
      const ranges = ['today', 'week', 'month'].filter((r) => flags[r]);
      if (ranges.length > 1) throw new Usage('pick one of --today, --week, --month');
      return { method: 'GET', route: `/cli/stats?range=${ranges[0] || 'today'}` };
    }
    case 'show': case 'hide': case 'toggle': case 'demo':
      none();
      return { method: 'POST', route: `/cli/${command}`, body: {} };
    case 'hooks':
      if (positional.length !== 1 || !['install', 'uninstall', 'status'].includes(positional[0])) {
        throw new Usage('hooks takes install, uninstall or status');
      }
      if (flags.assistant !== undefined && !assistantOf(flags.assistant)) {
        throw new Usage(`--assistant takes ${Object.keys(ASSISTANTS).join(', ')} (or antigravity)`);
      }
      return { method: 'POST', route: '/cli/hooks', body: { action: positional[0], ...(flags.assistant ? { assistant: assistantOf(flags.assistant) } : {}) } };
    default:
      throw new Usage(`unknown command "${command}"`);
  }
}

// One request to the app. Resolves { status, body }; rejects when nothing answers.
function request(method, route, body, { timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      socketPath: socketPath(),
      path: route,
      method,
      timeout,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('no answer'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(data);
  });
}

function away(err) {
  if (err.code === 'ETIMEDOUT') return "Hexa isn't answering";
  if (['ENOENT', 'ECONNREFUSED', 'ENOTDIR'].includes(err.code)) return "Hexa isn't running";
  return `can't reach Hexa (${err.code || err.message})`;
}

const out = (text) => process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
const note = (text) => process.stderr.write(`hexa: ${text}\n`);

function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function describeStatus(b) {
  const music = b.music && (b.music.title || b.music.player)
    ? `${[b.music.title, b.music.artist].filter(Boolean).join(' — ') || 'something'} (${b.music.player}${b.music.playing ? '' : ', paused'})`
    : 'nothing';
  return [
    `Hexa is running${b.pid ? ` (pid ${b.pid})` : ''}, ${b.visible === false ? 'in the background' : 'in front'}.`,
    `Do Not Disturb: ${b.dnd ? 'on' : 'off'}`,
    `Music: ${music}`,
    `${ASSISTANTS[b.assistant] || ASSISTANTS.claude} sessions: ${b.sessions ?? 0}`,
    `Hooks: ${hooksLine(b.hooks, b.assistant)}`,
  ].join('\n');
}

function hooksLine(h = {}, assistant = 'claude') {
  if (h.error) return h.error;
  const install = assistant && assistant !== 'claude' ? `hexa hooks install --assistant ${assistant}` : 'hexa hooks install';
  const state = h.installed ? 'installed' : `not installed (${install})`;
  return h.warning ? `${state}, but ${h.warning}` : state;
}

function describeSessions(list) {
  if (!Array.isArray(list) || !list.length) return 'No Claude Code sessions right now.';
  const rows = list.map((s) => [s.title || s.project || s.id || '?', s.state || '', s.tool || '', s.started ? age(Date.now() - s.started) : '']);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : String(c).padEnd(widths[i]))).join('  ').trimEnd()).join('\n');
}

// Whatever /cli/stats answers: its own text when it has some, else its fields one per line.
function describeStats(b) {
  if (typeof b.text === 'string') return b.text;
  const lines = Object.entries(b).filter(([k]) => k !== 'ok').map(([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : v}`);
  return lines.length ? lines.join('\n') : 'No stats yet.';
}

// What to do after installing, for each assistant.
const NEXT = {
  claude: 'Start a new Claude Code session for them to take effect.',
  codex: 'Codex runs only the hooks you trust: start a new Codex session, type /hooks and trust Hexa’s.',
  agy: 'Restart Antigravity (or start a new conversation) for them to take effect.',
};

function describeHooks(action, b, assistant = 'claude') {
  const warning = b.warning ? `\nNote: ${b.warning}` : '';
  if (action === 'install') return `Hexa hooks installed for ${b.events} events in ${b.file}\n${NEXT[assistant] || NEXT.claude}${warning}`;
  if (action === 'uninstall') return b.removed ? `Hexa hooks removed from ${b.file}` : `No Hexa hooks found in ${b.file}`;
  if (b.error) return b.error;
  return (b.installed ? `Installed (${(b.events || []).join(', ')}) in ${b.file}` : `Not installed (${b.file})`) + warning;
}

// For her ticker: the command as you'd type it.
function display(args) {
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');
}

// hexa run -- <command…>: the command runs with your terminal, whatever Hexa is doing.
async function run(args) {
  const command = display(args).slice(0, 500);
  const runId = crypto.randomBytes(8).toString('hex');
  const cwd = process.cwd();
  const told = await request('POST', '/cli/run-start', { run_id: runId, command, cwd }, { timeout: 1000 })
    .then((r) => {
      if (r.status < 300) return true;
      note(`Hexa didn't take it (${r.body?.error || r.status}); running it anyway`);
      return false;
    })
    .catch((err) => {
      note(`${away(err)}; running it anyway`);
      return false;
    });

  // Ctrl+C and Ctrl+\ reach the command straight from the terminal: we only wait for it to end.
  // A signal sent to us alone (kill, a closing terminal) is passed on to it.
  let child = null;
  const ignore = () => {};
  const forward = {
    SIGTERM: () => child?.kill('SIGTERM'),
    SIGHUP: () => child?.kill('SIGHUP'),
  };
  process.on('SIGINT', ignore);
  process.on('SIGQUIT', ignore);
  for (const [sig, fn] of Object.entries(forward)) process.on(sig, fn);

  const started = Date.now();
  const ended = await new Promise((resolve) => {
    child = spawn(args[0], args.slice(1), { stdio: 'inherit' });
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  process.off('SIGINT', ignore);
  process.off('SIGQUIT', ignore);
  for (const [sig, fn] of Object.entries(forward)) process.off(sig, fn);

  let code;
  let report;
  if (ended.error) {
    const missing = ended.error.code === 'ENOENT';
    code = missing ? 127 : 126;
    note(`${args[0]}: ${missing ? 'command not found' : ended.error.message}`);
    report = { code, signal: null };
  } else if (ended.signal) {
    code = 128 + (os.constants.signals[ended.signal] || 0);
    report = { code: null, signal: ended.signal };
  } else {
    code = ended.code;
    report = { code, signal: null };
  }
  if (told) {
    await request('POST', '/cli/run-end', { run_id: runId, command, cwd, ...report, duration_ms: Date.now() - started }, { timeout: 1000 })
      .catch(() => {});
  }
  return code;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (err) {
    if (!(err instanceof Usage)) throw err;
    if (err.message) note(err.message);
    process.stderr.write(err.message ? 'Try hexa --help.\n' : HELP);
    return EXIT.usage;
  }

  if (parsed.command === 'help') {
    out(HELP);
    return EXIT.ok;
  }
  if (parsed.command === 'version') {
    let version = 'unknown';
    try { version = require('../package.json').version; } catch { /* installed without it */ }
    out(`hexa ${version}`);
    return EXIT.ok;
  }
  if (parsed.command === 'run') return run(parsed.args);

  let req;
  try {
    req = requestFor(parsed);
  } catch (err) {
    if (!(err instanceof Usage)) throw err;
    note(err.message);
    process.stderr.write('Try hexa --help.\n');
    return EXIT.usage;
  }

  const { command, flags } = parsed;
  // fire and forget: a script saying something to her doesn't fail when she's not there
  const optional = ['say', 'react', 'notify'].includes(command);
  let res;
  try {
    res = await request(req.method, req.route, req.body);
  } catch (err) {
    if (flags.json) out(JSON.stringify({ ok: false, running: false, error: away(err) }));
    note(optional ? `${away(err)}, so she didn't hear that` : away(err));
    return optional ? EXIT.ok : EXIT.away;
  }

  const body = res.body && typeof res.body === 'object' ? res.body : {};
  if (res.status >= 300 || body.ok === false) {
    if (flags.json) out(JSON.stringify(body));
    note(body.error || `Hexa answered ${res.status}`);
    return EXIT.failed;
  }
  if (flags.json) {
    out(JSON.stringify(command === 'status' ? { running: true, ...body } : body, null, 2));
    return EXIT.ok;
  }
  if (command === 'status') out(describeStatus(body));
  else if (command === 'sessions') out(describeSessions(body.sessions));
  else if (command === 'stats') out(describeStats(body));
  else if (command === 'hooks') out(describeHooks(req.body.action, body, req.body.assistant));
  return EXIT.ok;
}

module.exports = { parse, requestFor, display, socketPath, describeStatus, describeSessions, describeStats, describeHooks, EXIT };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => {
      note(err.message);
      process.exitCode = EXIT.failed;
    },
  );
}
