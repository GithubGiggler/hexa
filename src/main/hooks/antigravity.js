'use strict';

// Adds (or removes) Hexa's hooks for Google Antigravity, in ~/.gemini/config/hooks.json: the global
// hooks file its App, CLI and IDE all read (https://antigravity.google/docs/hooks). That file maps
// hook names to their events, so Hexa's are one entry, "hexa", and everyone else's entries stay
// exactly as they are. Same care as claude.js: a file that can't be read is never touched, a
// backup comes first, the write is atomic and goes through symlinks.
//
// Only events where an empty answer ("{}") is documented to change nothing: never PreToolUse, whose
// answer must carry a decision.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hookCommand, placeHook, readJson, writeJson } = require('./files');
const { EVENTS } = require('../../../hooks/hexa-agy-hook');

const MARK = 'hexa-agy-hook.js';
const BASE = 'hexa-hook.js'; // the Antigravity hook runs through it: it's copied next to it
const KEY = 'hexa';
const TIMEOUT = 5; // seconds; Hexa's hook gives up after two
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']); // these take a matcher

// Antigravity has no setting for where ~/.gemini is. HEXA_GEMINI_DIR is Hexa's own, for tests.
function geminiDir() {
  const env = process.env.HEXA_GEMINI_DIR;
  return env ? path.resolve(env) : path.join(os.homedir(), '.gemini');
}

const hooksPath = () => path.join(geminiDir(), 'config', 'hooks.json');

// Every handler of a hook entry, tool events' (under a matcher) and the others'.
function handlers(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
  return Object.values(entry).flatMap((list) => (Array.isArray(list) ? list : []))
    .flatMap((item) => (Array.isArray(item?.hooks) ? item.hooks : [item]))
    .filter((h) => h && typeof h === 'object');
}

const isOurs = (entry) => handlers(entry).some((h) => String(h.command || '').includes(MARK));

function entryFor(commandFor) {
  const handler = (event) => ({ type: 'command', command: commandFor(event), timeout: TIMEOUT });
  return Object.fromEntries(EVENTS.map((event) => [
    event,
    TOOL_EVENTS.has(event) ? [{ matcher: '*', hooks: [handler(event)] }] : [handler(event)],
  ]));
}

// hooksDir: the app's hooks/ folder (hexa-hook.js and hexa-agy-hook.js).
function install({ hooksDir, dataDir, hasNode }) {
  placeHook(path.join(hooksDir, BASE), dataDir);
  const script = placeHook(path.join(hooksDir, MARK), dataDir);
  const file = hooksPath();
  const original = readJson(file);
  if (original[KEY] !== undefined && !isOurs(original[KEY])) {
    throw new Error(`${file} already has a hook named "${KEY}" that isn't Hexa's. Rename it first, nothing was changed.`);
  }
  const entry = entryFor((event) => hookCommand({ script, hasNode, args: [event] }));
  // in place, so an unchanged install leaves the file as it is
  const settings = {};
  let placed = false;
  for (const [name, value] of Object.entries(original)) {
    if (!isOurs(value)) settings[name] = value;
    else if (!placed) {
      settings[KEY] = entry;
      placed = true;
    }
  }
  if (!placed) settings[KEY] = entry;
  if (JSON.stringify(settings) !== JSON.stringify(original)) writeJson(file, settings);
  return { file, command: hookCommand({ script, hasNode }), events: EVENTS.length, script };
}

function uninstall() {
  const file = hooksPath();
  if (!fs.existsSync(file)) return { file, removed: false };
  const settings = readJson(file);
  const ours = Object.keys(settings).filter((name) => isOurs(settings[name]));
  for (const name of ours) delete settings[name];
  if (ours.length) writeJson(file, settings);
  return { file, removed: ours.length > 0 };
}

function status() {
  const file = hooksPath();
  try {
    const settings = readJson(file);
    const entry = Object.values(settings).find(isOurs);
    if (!entry) return { file, installed: false, events: [] };
    const out = { file, installed: true, events: Object.keys(entry).filter((e) => Array.isArray(entry[e])) };
    // turned off in Antigravity's Customizations › Hooks (or by hand)
    if (entry.enabled === false || handlers(entry).some((h) => h.enabled === false)) {
      out.warning = 'Hexa’s Antigravity hooks are turned off (Antigravity: Customizations › Hooks)';
    }
    return out;
  } catch (err) {
    return { file, installed: false, events: [], error: err.message };
  }
}

module.exports = { EVENTS, MARK, KEY, geminiDir, hooksPath, install, uninstall, status };
