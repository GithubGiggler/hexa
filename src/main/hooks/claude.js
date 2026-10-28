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
function placeHook(hookSource, dataDir) {
  const dir = path.join(dataDir, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, MARK);
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

function isHexaGroup(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((h) => String(h.command || '').includes(MARK));
}

function strip(settings) {
  if (!settings.hooks) return settings;
  for (const event of Object.keys(settings.hooks)) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    settings.hooks[event] = groups.filter((g) => !isHexaGroup(g));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

function write(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, `${file}.hexa-backup-${stamp}`);
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(temp, file);
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

function uninstall() {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { file, removed: false };
  const settings = readSettings(file);
  const before = JSON.stringify(settings);
  strip(settings);
  const removed = JSON.stringify(settings) !== before;
  if (removed) write(file, settings);
  return { file, removed };
}

function status() {
  const file = settingsPath();
  try {
    const settings = readSettings(file);
    const events = Object.entries(settings.hooks || {})
      .filter(([, groups]) => Array.isArray(groups) && groups.some(isHexaGroup))
      .map(([event]) => event);
    return { file, installed: events.length > 0, events };
  } catch (err) {
    return { file, installed: false, events: [], error: err.message };
  }
}

// Hexa's hooks on their own, for `claude --settings <file>`: try her out without touching your settings.
function settingsSnippet({ hookSource, dataDir, hasNode }) {
  const script = placeHook(hookSource, dataDir);
  return { hooks: groupsFor(hookCommand({ script, hasNode })) };
}

module.exports = { EVENTS, MARK, settingsPath, hookCommand, install, uninstall, status, settingsSnippet };
