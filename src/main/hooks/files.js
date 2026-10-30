// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.
'use strict';

// What every hook installer (claude.js, codex.js, antigravity.js) does to files the same careful
// way: a settings file we can't understand is never touched, a backup is written before any
// change, symlinks are written through, permissions are kept, and the new file is swapped in
// atomically.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function nodeOnPath() {
  try {
    return spawnSync('node', ['-v'], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

// With node on the machine the hook runs on it. Without, Hexa's own executable runs it as node:
// the AppImage file itself when that's how she's installed (its mount point changes every run).
// args: more words for the hook's command line (already safe to put there unquoted).
// Paths go in single quotes (inside double quotes the shell still runs $(...) and `...`: an
// AppImage downloaded as Hexa-$(...).AppImage would run on every hook).
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function hookCommand({ script, hasNode = nodeOnPath(), exe = process.env.APPIMAGE || process.execPath, args = [] }) {
  const tail = args.length ? ` ${args.join(' ')}` : '';
  return hasNode ? `node ${sq(script)}${tail}` : `ELECTRON_RUN_AS_NODE=1 ${sq(exe)} ${sq(script)}${tail}`;
}

// The hook is copied to Hexa's data dir so its path never moves (AppImage mounts, app updates).
function placeHook(hookSource, dataDir, name = path.basename(hookSource)) {
  const dir = path.join(dataDir, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, name);
  fs.copyFileSync(hookSource, script);
  fs.chmodSync(script, 0o644);
  return script;
}

// After an update: the copies of her hook scripts she installed (in dataDir/hooks) are brought up
// to date with the ones she ships. Only copies that exist are touched; returns what was refreshed.
function refreshHookCopies(shippedDir, dataDir) {
  const dir = path.join(dataDir, 'hooks');
  const done = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.js')); } catch { return done; }
  for (const name of names) {
    const shipped = path.join(shippedDir, name);
    try {
      const fresh = fs.readFileSync(shipped);
      if (!fresh.equals(fs.readFileSync(path.join(dir, name)))) {
        placeHook(shipped, dataDir, name);
        done.push(name);
      }
    } catch { /* not one of hers */ }
  }
  return done;
}

// A JSON settings file as an object: {} when it's missing or empty. Anything else we can't use
// (not JSON, or JSON that isn't an object) throws, and nothing gets written over it.
function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}). Fix it first, nothing was changed.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} doesn't hold a JSON object. Fix it first, nothing was changed.`);
  }
  return value;
}

// Writes through a symlink (dotfiles managers keep settings in a repo) to the real file, keeps
// its permissions (it can hold tokens), backs it up first, and swaps it in atomically.
// A new file is readable only by you.
// The last few backups are kept (each may hold tokens under "env"): older ones go.
const KEEP_BACKUPS = 5;
function pruneBackups(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.hexa-backup-`;
  try {
    const all = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, old), { force: true });
  } catch { /* nothing to prune */ }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exists = fs.existsSync(file);
  const real = exists ? fs.realpathSync(file) : file;
  const mode = exists ? fs.statSync(real).mode & 0o777 : 0o600;
  if (exists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.hexa-backup-${stamp}`;
    fs.copyFileSync(real, backup);
    fs.chmodSync(backup, mode);
    pruneBackups(file);
  }
  const temp = `${real}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode });
    fs.chmodSync(temp, mode); // the umask may have taken bits off
    fs.renameSync(temp, real);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2) + '\n');
}

module.exports = { nodeOnPath, hookCommand, placeHook, refreshHookCopies, readJson, writeText, writeJson };
