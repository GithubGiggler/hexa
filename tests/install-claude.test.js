'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const claude = require('../src/main/hooks/claude');

const HOOK = path.join(__dirname, '..', 'hooks', 'hexa-hook.js');

// a fresh Claude config dir (not created yet) and a fresh Hexa data dir
function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-inst-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude-home');
  return { root, dataDir: path.join(root, 'data'), file: path.join(root, 'claude-home', 'settings.json') };
}

const opts = (dataDir) => ({ hookSource: HOOK, dataDir, hasNode: true });
const backups = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('settings.json.hexa-backup-'));

test('creates ~/.claude/settings.json when the folder is missing', () => {
  const { dataDir, file } = fresh();
  const r = claude.install(opts(dataDir));
  assert.equal(r.file, file);
  assert.equal(r.events, 13);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks).sort(), [...claude.EVENTS].sort());
  const entry = settings.hooks.Stop[0].hooks[0];
  assert.deepEqual({ type: entry.type, async: entry.async, timeout: entry.timeout }, { type: 'command', async: true, timeout: 10 });
  assert.match(entry.command, /hexa-hook\.js/);
  assert.equal(backups(file).length, 0, 'nothing to back up');
});

test('empty settings file is treated as {}', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '  \n');
  claude.install(opts(dataDir));
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).length, 13);
});

test('invalid JSON: throws and leaves the file byte-identical', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const broken = '{ "model": "x", // a comment\n }';
  fs.writeFileSync(file, broken);
  assert.throws(() => claude.install(opts(dataDir)), /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), broken);
  assert.equal(backups(file).length, 0);
});

test('keeps foreign hooks and other settings', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] } }));
  claude.install(opts(dataDir));
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.model, 'x');
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'other.sh');
  assert.equal(backups(file).length, 1, 'backed up before changing it');
});

test('idempotent: second install changes nothing and makes no backup', () => {
  const { dataDir, file } = fresh();
  claude.install(opts(dataDir));
  const first = fs.readFileSync(file, 'utf8');
  claude.install(opts(dataDir));
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(backups(file).length, 0);
});

test('uninstall removes only Hexa groups and empty containers', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] } }));
  claude.install(opts(dataDir));
  const r = claude.uninstall();
  assert.equal(r.removed, true);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(settings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other.sh' }] }] } });
  assert.equal(claude.uninstall().removed, false);
});

test('uninstall with nothing installed leaves no hooks key behind', () => {
  const { dataDir, file } = fresh();
  claude.install(opts(dataDir));
  claude.uninstall();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
});

test('status lists the installed events', () => {
  const { dataDir } = fresh();
  assert.equal(claude.status().installed, false);
  claude.install(opts(dataDir));
  const s = claude.status();
  assert.equal(s.installed, true);
  assert.equal(s.events.length, 13);
});

test('copies the hook to dataDir/hooks and points the command at the copy', () => {
  const { dataDir } = fresh();
  const r = claude.install(opts(dataDir));
  const copy = path.join(dataDir, 'hooks', 'hexa-hook.js');
  assert.equal(r.script, copy);
  assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(HOOK, 'utf8'));
  assert.equal(r.command, `node "${copy}"`);
});

test('hookCommand without node uses ELECTRON_RUN_AS_NODE and the AppImage', () => {
  const saved = process.env.APPIMAGE;
  process.env.APPIMAGE = '/home/u/Hexa.AppImage';
  try {
    assert.equal(claude.hookCommand({ script: '/d/h.js', hasNode: false }), 'ELECTRON_RUN_AS_NODE=1 "/home/u/Hexa.AppImage" "/d/h.js"');
    assert.equal(claude.hookCommand({ script: '/d/h.js', hasNode: false, exe: '/opt/Hexa/hexa' }), 'ELECTRON_RUN_AS_NODE=1 "/opt/Hexa/hexa" "/d/h.js"');
  } finally {
    if (saved === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = saved;
  }
});

test('settingsSnippet is just the hooks, for claude --settings', () => {
  const { dataDir, file } = fresh();
  const snippet = claude.settingsSnippet(opts(dataDir));
  assert.deepEqual(Object.keys(snippet), ['hooks']);
  assert.equal(Object.keys(snippet.hooks).length, 13);
  assert.equal(fs.existsSync(file), false, 'real settings untouched');
});

test('a symlinked settings.json stays a link, its real file updated, its mode kept', () => {
  const { dataDir, file } = fresh();
  const dotfiles = path.join(path.dirname(path.dirname(file)), 'dotfiles');
  fs.mkdirSync(dotfiles, { recursive: true });
  const real = path.join(dotfiles, 'claude-settings.json');
  fs.writeFileSync(real, JSON.stringify({ env: { SECRET: 'x' } }));
  fs.chmodSync(real, 0o600);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  claude.install(opts(dataDir));
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true, 'still a symlink');
  const settings = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.equal(settings.env.SECRET, 'x');
  assert.equal(Object.keys(settings.hooks).length, 13, 'the real file got the hooks');
  assert.equal(fs.statSync(real).mode & 0o777, 0o600, 'mode kept');
  claude.uninstall();
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true, 'still a symlink after uninstall');
  assert.equal(fs.statSync(real).mode & 0o777, 0o600);
});

test('a new settings.json is created readable only by you', () => {
  const { dataDir, file } = fresh();
  claude.install(opts(dataDir));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

const PERMISSION_HOOK = path.join(__dirname, '..', 'hooks', 'hexa-permission-hook.js');
const permOpts = (dataDir) => ({ hookSource: PERMISSION_HOOK, dataDir, hasNode: true });

test('the permission hook: one synchronous PermissionRequest hook, its own script, a bounded timeout', () => {
  const { dataDir, file } = fresh();
  const r = claude.installPermission(permOpts(dataDir));
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks), ['PermissionRequest']);
  const entry = settings.hooks.PermissionRequest[0].hooks[0];
  assert.equal(entry.type, 'command');
  assert.equal(entry.async, undefined, 'its answer has to count: not async');
  assert.equal(entry.timeout, claude.PERMISSION_TIMEOUT);
  assert.match(entry.command, /hexa-permission-hook\.js/);
  assert.ok(fs.existsSync(r.script));
  assert.equal(claude.status().permission, true);
  claude.installPermission(permOpts(dataDir));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PermissionRequest.length, 1, 'installing twice adds it once');
});

test('re-installing her event hooks keeps the permission hook; removing her hooks removes both', () => {
  const { dataDir, file } = fresh();
  claude.installPermission(permOpts(dataDir));
  claude.install(opts(dataDir));
  let settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.hooks.PermissionRequest.length, 1);
  assert.equal(Object.keys(settings.hooks).length, 14);
  claude.uninstallPermission();
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.hooks.PermissionRequest, undefined);
  assert.equal(Object.keys(settings.hooks).length, 13, 'her event hooks stay');
  claude.installPermission(permOpts(dataDir));
  claude.uninstall();
  assert.equal(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).hooks, undefined);
  assert.equal(claude.status().permission, false);
});

test('someone else\'s PermissionRequest hooks are left alone', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const theirs = { hooks: [{ type: 'command', command: '/usr/local/bin/my-guard' }] };
  fs.writeFileSync(file, JSON.stringify({ hooks: { PermissionRequest: [theirs] } }));
  claude.installPermission(permOpts(dataDir));
  claude.uninstallPermission();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PermissionRequest, [theirs]);
});
