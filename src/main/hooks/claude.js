// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// Adds (or removes) Hexa's hooks in ~/.claude/settings.json.
// Existing settings and hooks are kept, a timestamped backup is written before any change,
// and a file that isn't valid JSON is never touched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
];

const MARK = 'hexa-hook.js';
// The opt-in permission hook (answer permissions from her): synchronous, so its answer counts.
// Hexa answers within her wait (60 s at most); the timeout is that plus a margin.
const PERMISSION_MARK = 'hexa-permission-hook.js';
const PERMISSION_TIMEOUT = 65;

function settingsPath() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'settings.json');
}

function nodeOnPath() {
  try {
    return spawnSync('node', ['-v'], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

// With node on the machine the hook runs on it. Without, Hexa's own executable runs it as node:
// the AppImage file itself when that's how she's installed (its mount point changes every run).
function hookCommand({ script, hasNode = nodeOnPath(), exe = process.env.APPIMAGE || process.execPath }) {
  return hasNode ? `node "${script}"` : `ELECTRON_RUN_AS_NODE=1 "${exe}" "${script}"`;
}

// The hook is copied to Hexa's data dir so its path never moves (AppImage mounts, app updates).
function placeHook(hookSource, dataDir, name = MARK) {
  const dir = path.join(dataDir, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, name);
  fs.copyFileSync(hookSource, script);
  fs.chmodSync(script, 0o644);
  return script;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    // Never overwrite a file we could not understand.
    throw new Error(`${file} is not valid JSON (${err.message}). Fix it first, nothing was changed.`);
  }
}

function isHexaGroup(group, marks = [MARK]) {
  return Array.isArray(group?.hooks) && group.hooks.some((h) => marks.some((m) => String(h.command || '').includes(m)));
}

// Takes Hexa's hooks out (those whose command runs one of marks' scripts), nobody else's.
function strip(settings, marks = [MARK]) {
  if (!settings.hooks) return settings;
  for (const event of Object.keys(settings.hooks)) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    settings.hooks[event] = groups.filter((g) => !isHexaGroup(g, marks));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

// Writes through a symlink (dotfiles managers keep settings.json in a repo) to the real file, keeps
// its permissions (it can hold tokens under "env"), backs it up first, and swaps it in atomically.
// A new file is readable only by you.
function write(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exists = fs.existsSync(file);
  const real = exists ? fs.realpathSync(file) : file;
  const mode = exists ? fs.statSync(real).mode & 0o777 : 0o600;
  if (exists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.hexa-backup-${stamp}`;
    fs.copyFileSync(real, backup);
    fs.chmodSync(backup, mode);
  }
  const temp = `${real}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { mode });
  fs.chmodSync(temp, mode); // the umask may have taken bits off
  fs.renameSync(temp, real);
}

function groupsFor(command) {
  return Object.fromEntries(EVENTS.map((event) => [event, [
    { hooks: [{ type: 'command', command, async: true, timeout: 10 }] },
  ]]));
}

function install({ hookSource, dataDir, hasNode }) {
  const script = placeHook(hookSource, dataDir);
  const command = hookCommand({ script, hasNode });
  const file = settingsPath();
  const original = readSettings(file);
  const before = JSON.stringify(original);
  const settings = strip(original);
  settings.hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(groupsFor(command))) {
    settings.hooks[event] = [...(settings.hooks[event] || []), ...groups];
  }
  if (JSON.stringify(settings) !== before) write(file, settings); // already up to date: no backup spam
  return { file, command, events: EVENTS.length, script };
}

// All of Hexa's hooks, the permission hook too.
function uninstall({ marks = [MARK, PERMISSION_MARK] } = {}) {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { file, removed: false };
  const settings = readSettings(file);
  const before = JSON.stringify(settings);
  strip(settings, marks);
  const removed = JSON.stringify(settings) !== before;
  if (removed) write(file, settings);
  return { file, removed };
}

// Answering permissions from her (opt-in): one synchronous PermissionRequest hook.
function installPermission({ hookSource, dataDir, hasNode }) {
  const script = placeHook(hookSource, dataDir, PERMISSION_MARK);
  const command = hookCommand({ script, hasNode });
  const file = settingsPath();
  const original = readSettings(file);
  const before = JSON.stringify(original);
  const settings = strip(original, [PERMISSION_MARK]);
  settings.hooks = settings.hooks || {};
  settings.hooks.PermissionRequest = [
    ...(settings.hooks.PermissionRequest || []),
    { hooks: [{ type: 'command', command, timeout: PERMISSION_TIMEOUT }] },
  ];
  if (JSON.stringify(settings) !== before) write(file, settings);
  return { file, command, script };
}

function uninstallPermission() {
  return uninstall({ marks: [PERMISSION_MARK] });
}

function status() {
  const file = settingsPath();
  try {
    const settings = readSettings(file);
    const events = Object.entries(settings.hooks || {})
      .filter(([, groups]) => Array.isArray(groups) && groups.some((g) => isHexaGroup(g)))
      .map(([event]) => event);
    const permission = Array.isArray(settings.hooks?.PermissionRequest)
      && settings.hooks.PermissionRequest.some((g) => isHexaGroup(g, [PERMISSION_MARK]));
    return { file, installed: events.length > 0, events, permission };
  } catch (err) {
    return { file, installed: false, events: [], permission: false, error: err.message };
  }
}

// Hexa's hooks on their own, for `claude --settings <file>`: try her out without touching your settings.
function settingsSnippet({ hookSource, dataDir, hasNode }) {
  const script = placeHook(hookSource, dataDir);
  return { hooks: groupsFor(hookCommand({ script, hasNode })) };
}

module.exports = {
  EVENTS, MARK, PERMISSION_MARK, PERMISSION_TIMEOUT, settingsPath, hookCommand,
  install, uninstall, installPermission, uninstallPermission, status, settingsSnippet,
};
