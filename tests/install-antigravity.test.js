'use strict';

// src/main/hooks/antigravity.js, always on a temporary ~/.gemini (HEXA_GEMINI_DIR): the real one is
// never touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agy = require('../src/main/hooks/antigravity');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-agy-'));
  process.env.HEXA_GEMINI_DIR = path.join(root, 'gemini');
  return { root, dataDir: path.join(root, 'data'), file: path.join(root, 'gemini', 'config', 'hooks.json') };
}

const opts = (dataDir) => ({ hooksDir: HOOKS_DIR, dataDir, hasNode: true });
const backups = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('hooks.json.hexa-backup-'));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// someone else's hooks, shaped as Antigravity's docs show them
const linter = { PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/lint.sh', timeout: 10 }] }] };
const gate = { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: './gate.sh', enabled: false }] }] };

test('the global hooks file, under a temporary ~/.gemini', () => {
  const { root, file } = fresh();
  assert.equal(agy.hooksPath(), file);
  assert.ok(file.startsWith(root));
  assert.notEqual(agy.geminiDir(), path.join(os.homedir(), '.gemini'));
});

test('creates ~/.gemini/config/hooks.json: one "hexa" entry, never PreToolUse, each event named on its command', () => {
  const { dataDir, file } = fresh();
  const r = agy.install(opts(dataDir));
  assert.equal(r.file, file);
  const settings = read(file);
  assert.deepEqual(Object.keys(settings), ['hexa']);
  const entry = settings.hexa;
  assert.deepEqual(Object.keys(entry), ['SessionStart', 'PreInvocation', 'PostToolUse', 'Stop']);
  assert.equal(entry.PreToolUse, undefined, 'a PreToolUse answer must carry a decision: she never gives one');
  const script = path.join(dataDir, 'hooks', 'hexa-agy-hook.js');
  assert.deepEqual(entry.PostToolUse, [{ matcher: '*', hooks: [{ type: 'command', command: `node '${script}' PostToolUse`, timeout: 5 }] }]);
  for (const event of ['SessionStart', 'PreInvocation', 'Stop']) {
    assert.deepEqual(entry[event], [{ type: 'command', command: `node '${script}' ${event}`, timeout: 5 }]);
  }
  assert.equal(r.events, 4);
  assert.equal(backups(file).length, 0);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  for (const name of ['hexa-agy-hook.js', 'hexa-hook.js']) assert.ok(fs.existsSync(path.join(dataDir, 'hooks', name)), name);
});

test('keeps everyone else’s hooks as they are, and backs the file up first', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'my-linter-hook': linter, 'safety-gate': gate }));
  agy.install(opts(dataDir));
  const settings = read(file);
  assert.deepEqual(Object.keys(settings), ['my-linter-hook', 'safety-gate', 'hexa']);
  assert.deepEqual(settings['my-linter-hook'], linter);
  assert.deepEqual(settings['safety-gate'], gate);
  assert.equal(backups(file).length, 1);
});

test('idempotent, in place: a second install leaves the file byte for byte', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'my-linter-hook': linter }));
  agy.install(opts(dataDir));
  // someone adds a hook after hers: hers stays where it is
  const settings = read(file);
  settings.later = gate;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  const before = fs.readFileSync(file, 'utf8');
  const count = backups(file).length;
  agy.install(opts(dataDir));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(backups(file).length, count);
});

test('an older Hexa entry under another name is replaced, not doubled', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'hexa-old': { Stop: [{ type: 'command', command: 'node "/old/hooks/hexa-agy-hook.js" Stop' }] }, other: linter }));
  agy.install(opts(dataDir));
  assert.deepEqual(Object.keys(read(file)), ['hexa', 'other']);
});

test('a hook of someone else’s that happens to be called "hexa" is never overwritten', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify({ hexa: linter });
  fs.writeFileSync(file, text);
  assert.throws(() => agy.install(opts(dataDir)), /isn't Hexa's/);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(agy.uninstall().removed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('invalid JSON, or not an object: throws and leaves the file byte-identical', () => {
  for (const broken of ['{ "a": 1, }', '[]', 'null']) {
    const { dataDir, file } = fresh();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, broken);
    assert.throws(() => agy.install(opts(dataDir)), /nothing was changed/, broken);
    assert.throws(() => agy.uninstall(), /nothing was changed/, broken);
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
    assert.equal(backups(file).length, 0);
    assert.match(agy.status().error, /nothing was changed/);
  }
});

test('uninstall takes out her entry only', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'my-linter-hook': linter }));
  agy.install(opts(dataDir));
  assert.equal(agy.uninstall().removed, true);
  assert.deepEqual(read(file), { 'my-linter-hook': linter });
  assert.equal(agy.uninstall().removed, false);
  const none = fresh();
  assert.deepEqual(agy.uninstall(), { file: none.file, removed: false });
  assert.equal(fs.existsSync(none.file), false, 'nothing created');
});

test('a symlinked hooks.json stays a link, its mode kept', () => {
  const { root, dataDir, file } = fresh();
  const real = path.join(root, 'dotfiles', 'agy-hooks.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, JSON.stringify({ 'my-linter-hook': linter }));
  fs.chmodSync(real, 0o644);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  agy.install(opts(dataDir));
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.ok(read(real).hexa);
  assert.equal(fs.statSync(real).mode & 0o777, 0o644);
  agy.uninstall();
  assert.deepEqual(read(real), { 'my-linter-hook': linter });
});

test('status: her events, and a warning when she was turned off in Antigravity', () => {
  const { dataDir, file } = fresh();
  assert.deepEqual(agy.status(), { file, installed: false, events: [] });
  agy.install(opts(dataDir));
  assert.deepEqual(agy.status(), { file, installed: true, events: agy.EVENTS });
  const settings = read(file);
  settings.hexa.Stop[0].enabled = false;
  fs.writeFileSync(file, JSON.stringify(settings));
  assert.match(agy.status().warning, /turned off/);
});

test('without node, the AppImage runs her hook, the event still on its command line', () => {
  const { dataDir, file } = fresh();
  const saved = process.env.APPIMAGE;
  process.env.APPIMAGE = '/home/u/Hexa.AppImage';
  try {
    agy.install({ hooksDir: HOOKS_DIR, dataDir, hasNode: false });
  } finally {
    if (saved === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = saved;
  }
  const script = path.join(dataDir, 'hooks', 'hexa-agy-hook.js');
  assert.equal(read(file).hexa.Stop[0].command, `ELECTRON_RUN_AS_NODE=1 '/home/u/Hexa.AppImage' '${script}' Stop`);
});
