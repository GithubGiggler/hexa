// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// Adds (or removes) Hexa's hooks in ~/.claude/settings.json.
// Existing settings and hooks are kept, a timestamped backup is written before any change,
// and a file that isn't valid JSON is never touched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hookCommand, placeHook, readJson: readSettings, writeJson: write } = require('./files');

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

// The hook files, settings reading and the careful write (backup, symlinks, permissions, atomic
// swap) are files.js's, shared with the Codex and Antigravity installers.

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
