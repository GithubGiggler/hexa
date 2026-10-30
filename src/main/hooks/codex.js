'use strict';

// Adds (or removes) Hexa's hooks for the OpenAI Codex CLI, in $CODEX_HOME/hooks.json (~/.codex by
// default). Codex documents hooks.json and inline [hooks] tables in config.toml as equivalent
// (https://developers.openai.com/codex/hooks); Hexa writes hooks.json, plain JSON she can edit
// without a TOML parser, and only ever reads config.toml, to tell you when something there gets
// in the way. Same care as claude.js: others' hooks and settings are kept, a file that can't be
// read is never touched, a backup comes first, the write is atomic and goes through symlinks.
//
// Codex runs a hook only once you've trusted it (/hooks in Codex); the trust is tied to the hook's
// hash, so an unchanged reinstall keeps it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hookCommand, placeHook, readJson, writeJson } = require('./files');

const MARK = 'hexa-codex-hook.js';
const BASE = 'hexa-hook.js'; // the codex hook runs through it: it's copied next to it
// Every Codex hook event but PostCompact (nothing for Hexa in it)
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
  'SessionEnd',
];
const TIMEOUT = 10;
// Codex gives these one second by default and three at most; Hexa's hook gives up after two
const SHORT = { Interrupt: 2, SessionEnd: 2 };

function codexHome() {
  const env = process.env.CODEX_HOME;
  return env ? path.resolve(env) : path.join(os.homedir(), '.codex');
}

const hooksPath = () => path.join(codexHome(), 'hooks.json');
const configPath = () => path.join(codexHome(), 'config.toml');

const isHexaHandler = (h) => String(h?.command || '').includes(MARK);
const isHexaGroup = (g) => Array.isArray(g?.hooks) && g.hooks.some(isHexaHandler);

// The hooks object of a hooks.json, checked: anything but an object of arrays is left alone.
function hooksOf(settings, file) {
  const hooks = settings.hooks;
  if (hooks === undefined) return {};
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`${file}: "hooks" isn't an object. Fix it first, nothing was changed.`);
  }
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`${file}: hooks.${event} isn't a list. Fix it first, nothing was changed.`);
  }
  return hooks;
}

// Takes Hexa's groups out, nobody else's, and the containers that leaves empty.
function strip(settings, file) {
  if (settings.hooks === undefined) return settings;
  const hooks = hooksOf(settings, file);
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].filter((g) => !isHexaGroup(g));
    if (hooks[event].length === 0) delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

function groupsFor(command) {
  // async: in the background, so Codex never waits on her (and her hook can't answer anything)
  return Object.fromEntries(EVENTS.map((event) => [event, [
    { hooks: [{ type: 'command', command, async: true, timeout: SHORT[event] || TIMEOUT }] },
  ]]));
}

// hooksDir: the app's hooks/ folder (hexa-hook.js and hexa-codex-hook.js).
function install({ hooksDir, dataDir, hasNode }) {
  placeHook(path.join(hooksDir, BASE), dataDir);
  const script = placeHook(path.join(hooksDir, MARK), dataDir);
  const command = hookCommand({ script, hasNode });
  const file = hooksPath();
  const original = readJson(file);
  const before = JSON.stringify(original);
  const settings = strip(original, file);
  settings.hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(groupsFor(command))) {
    settings.hooks[event] = [...(settings.hooks[event] || []), ...groups];
  }
  if (JSON.stringify(settings) !== before) writeJson(file, settings); // already up to date: no backup
  return { file, command, events: EVENTS.length, script, ...configNotes() };
}

function uninstall() {
  const file = hooksPath();
  if (!fs.existsSync(file)) return { file, removed: false };
  const settings = readJson(file);
  const before = JSON.stringify(settings);
  strip(settings, file);
  const removed = JSON.stringify(settings) !== before;
  if (removed) writeJson(file, settings);
  return { file, removed };
}

function status() {
  const file = hooksPath();
  try {
    const hooks = hooksOf(readJson(file), file);
    const events = Object.entries(hooks).filter(([, groups]) => groups.some(isHexaGroup)).map(([event]) => event);
    return { file, installed: events.length > 0, events, ...configNotes() };
  } catch (err) {
    return { file, installed: false, events: [], error: err.message };
  }
}

// ---- config.toml, read only ----

// The lines of a TOML file as code: comments gone, the inside of strings blanked (a "#" or a
// "[hooks]" in a string is not one), multi-line strings folded into the line they start on. Enough
// to find table headers and keys; not a TOML parser.
function tomlLines(text) {
  const out = [];
  let line = '';
  let open = null; // the multi-line string we're in: '"""' or "'''"
  for (const raw of String(text).split(/\r?\n/)) {
    let i = 0;
    while (i < raw.length) {
      if (open) {
        if (open === '"""' && raw[i] === '\\') { i += 2; continue; }
        if (raw.startsWith(open, i)) {
          line += '""';
          i += 3;
          while (raw[i] === open[0]) i += 1; // up to two quotes may close it
          open = null;
          continue;
        }
        i += 1;
        continue;
      }
      const c = raw[i];
      if (c === '#') break;
      if (raw.startsWith('"""', i) || raw.startsWith("'''", i)) {
        open = raw.slice(i, i + 3);
        i += 3;
        continue;
      }
      if (c === '"' || c === "'") {
        // a one-line string: kept whole when it's a key ("hooks" = ...), blanked otherwise
        let j = i + 1;
        while (j < raw.length && raw[j] !== c) j += c === '"' && raw[j] === '\\' ? 2 : 1;
        const inner = raw.slice(i + 1, j);
        line += /^[A-Za-z0-9_-]+$/.test(inner) ? inner : '""';
        i = j + 1;
        continue;
      }
      line += c;
      i += 1;
    }
    if (open) continue; // the string goes on: so does the line
    out.push(line.trim());
    line = '';
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

const keyPath = (s) => s.split('.').map((p) => p.trim()).filter(Boolean).join('.');

// What config.toml says that matters to Hexa's hooks: are hooks turned off ([features] hooks = false,
// or the old codex_hooks), and does it hold inline [hooks] tables of its own (Codex then loads
// both those and hooks.json, and warns).
function scanConfig(text) {
  let table = '';
  const flags = {};
  let inline = false;
  let depth = 0; // inside a value's [ ] or { } that goes on over more lines: no headers there
  const nesting = (s) => (s.match(/[[{]/g) || []).length - (s.match(/[\]}]/g) || []).length;
  for (const code of tomlLines(text)) {
    if (!code) continue;
    if (depth > 0) {
      depth = Math.max(0, depth + nesting(code));
      continue;
    }
    const header = /^\[\[?([^[\]]+)\]\]?$/.exec(code);
    if (header) {
      table = keyPath(header[1]);
      if (table === 'hooks' || table.startsWith('hooks.')) inline = true;
      continue;
    }
    const kv = /^([A-Za-z0-9_.\s-]+?)\s*=\s*(.*)$/.exec(code);
    if (!kv) continue;
    const key = table ? `${table}.${keyPath(kv[1])}` : keyPath(kv[1]);
    const value = kv[2].trim();
    depth = Math.max(0, nesting(value));
    if (key === 'hooks' || key.startsWith('hooks.')) inline = true;
    if (key === 'features.hooks' || key === 'features.codex_hooks') flags[key.slice(9)] = /^true\b/.test(value) ? true : /^false\b/.test(value) ? false : undefined;
    if (key === 'features') {
      for (const m of value.matchAll(/\b(hooks|codex_hooks)\s*=\s*(true|false)\b/g)) flags[m[1]] = m[2] === 'true';
    }
  }
  const disabled = flags.hooks === false || (flags.hooks === undefined && flags.codex_hooks === false);
  return { disabled, inline };
}

function configNotes() {
  let text;
  try {
    text = fs.readFileSync(configPath(), 'utf8');
  } catch {
    return {}; // no config.toml: nothing in the way
  }
  const { disabled, inline } = scanConfig(text);
  if (disabled) return { warning: `Codex has hooks turned off in ${configPath()} ([features] hooks = false)` };
  if (inline) return { warning: `${configPath()} has [hooks] of its own: Codex runs them and hooks.json, and warns about having both` };
  return {};
}

module.exports = {
  EVENTS, MARK, codexHome, hooksPath, configPath, install, uninstall, status, scanConfig, tomlLines,
};
