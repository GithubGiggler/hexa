'use strict';

// src/main/hooks/codex.js, always on a temporary $CODEX_HOME: the real ~/.codex is never touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const codex = require('../src/main/hooks/codex');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

// a fresh $CODEX_HOME (not created yet) and a fresh Hexa data dir
function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-codex-'));
  process.env.CODEX_HOME = path.join(root, 'codex-home');
  return {
    root,
    dataDir: path.join(root, 'data'),
    file: path.join(root, 'codex-home', 'hooks.json'),
    toml: path.join(root, 'codex-home', 'config.toml'),
  };
}

const opts = (dataDir) => ({ hooksDir: HOOKS_DIR, dataDir, hasNode: true });
const backups = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('hooks.json.hexa-backup-'));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const theirs = { hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/policy.py', timeout: 30 }] };

test('$CODEX_HOME is where it goes, never the real ~/.codex', () => {
  const { root, file } = fresh();
  assert.equal(codex.hooksPath(), file);
  assert.ok(codex.hooksPath().startsWith(root));
  assert.notEqual(codex.codexHome(), path.join(os.homedir(), '.codex'));
});

test('creates hooks.json when the folder is missing: every event, in the background, bounded', () => {
  const { dataDir, file } = fresh();
  const r = codex.install(opts(dataDir));
  assert.equal(r.file, file);
  assert.equal(r.events, 11);
  const settings = read(file);
  assert.deepEqual(Object.keys(settings), ['hooks']);
  assert.deepEqual(Object.keys(settings.hooks), codex.EVENTS);
  assert.ok(!codex.EVENTS.includes('PostCompact'));
  for (const event of codex.EVENTS) {
    assert.equal(settings.hooks[event].length, 1);
    const group = settings.hooks[event][0];
    assert.equal(group.matcher, undefined, 'no matcher: every occurrence');
    const [h] = group.hooks;
    assert.equal(h.type, 'command');
    assert.equal(h.async, true, 'Codex never waits on her');
    assert.equal(h.command, r.command);
    assert.ok(h.timeout <= (['SessionEnd', 'Interrupt'].includes(event) ? 3 : 10), `${event}: within Codex's limits`);
  }
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].timeout, 2);
  assert.equal(backups(file).length, 0, 'nothing to back up');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a new file is yours alone');
});

test('copies its hook and the one it runs through to dataDir/hooks, and points the command at the copy', () => {
  const { dataDir } = fresh();
  const r = codex.install(opts(dataDir));
  const copy = path.join(dataDir, 'hooks', 'hexa-codex-hook.js');
  assert.equal(r.script, copy);
  assert.equal(r.command, `node '${copy}'`);
  for (const name of ['hexa-codex-hook.js', 'hexa-hook.js']) {
    assert.equal(fs.readFileSync(path.join(dataDir, 'hooks', name), 'utf8'), fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8'));
  }
});

test('keeps other hooks and the rest of the file; backs it up before changing it', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ description: 'my hooks', hooks: { PreToolUse: [{ matcher: '^Bash$', ...theirs }] } }));
  codex.install(opts(dataDir));
  const settings = read(file);
  assert.equal(settings.description, 'my hooks');
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.deepEqual(settings.hooks.PreToolUse[0], { matcher: '^Bash$', ...theirs });
  assert.equal(backups(file).length, 1);
});

test('idempotent: a second install changes nothing (Codex keeps trusting the same hash) and makes no backup', () => {
  const { dataDir, file } = fresh();
  codex.install(opts(dataDir));
  const first = fs.readFileSync(file, 'utf8');
  codex.install(opts(dataDir));
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(backups(file).length, 0);
});

test('invalid JSON, or JSON of the wrong shape: throws and leaves the file byte-identical', () => {
  for (const broken of ['{ "hooks": { // a comment\n } }', '[]', '"hooks"', '{"hooks": []}', '{"hooks": {"Stop": {"command": "x"}}}']) {
    const { dataDir, file } = fresh();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, broken);
    assert.throws(() => codex.install(opts(dataDir)), /nothing was changed/, broken);
    assert.throws(() => codex.uninstall(), /nothing was changed/, broken);
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
    assert.equal(backups(file).length, 0);
    const s = codex.status();
    assert.equal(s.installed, false);
    assert.match(s.error, /nothing was changed/);
  }
});

test('an empty hooks.json counts as {}', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '\n');
  codex.install(opts(dataDir));
  assert.equal(Object.keys(read(file).hooks).length, 11);
});

test('uninstall takes out only Hexa’s groups, and the containers that leaves empty', () => {
  const { dataDir, file } = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [theirs] } }));
  codex.install(opts(dataDir));
  assert.equal(codex.uninstall().removed, true);
  assert.deepEqual(read(file), { hooks: { Stop: [theirs] } });
  assert.equal(codex.uninstall().removed, false);
  const alone = fresh();
  codex.install(opts(alone.dataDir));
  codex.uninstall();
  assert.deepEqual(read(alone.file), {});
  assert.deepEqual(codex.uninstall(), { file: alone.file, removed: false });
});

test('uninstall without a hooks.json creates nothing', () => {
  const { file } = fresh();
  assert.deepEqual(codex.uninstall(), { file, removed: false });
  assert.equal(fs.existsSync(path.dirname(file)), false);
});

test('a symlinked hooks.json stays a link, its real file updated, its mode kept', () => {
  const { root, dataDir, file } = fresh();
  const real = path.join(root, 'dotfiles', 'codex-hooks.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, JSON.stringify({ hooks: { Stop: [theirs] } }));
  fs.chmodSync(real, 0o640);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  codex.install(opts(dataDir));
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(read(real).hooks.Stop.length, 2);
  assert.equal(fs.statSync(real).mode & 0o777, 0o640);
  codex.uninstall();
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.deepEqual(read(real), { hooks: { Stop: [theirs] } });
});

test('status: the installed events, nothing else’s', () => {
  const { dataDir, file } = fresh();
  assert.deepEqual(codex.status(), { file, installed: false, events: [] });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [theirs] } }));
  assert.equal(codex.status().installed, false, 'someone else’s hooks aren’t hers');
  codex.install(opts(dataDir));
  const s = codex.status();
  assert.equal(s.installed, true);
  assert.deepEqual(s.events, ['Stop', ...codex.EVENTS.filter((e) => e !== 'Stop')]);
  assert.equal(s.warning, undefined);
});

test('config.toml is only ever read: hooks turned off there, or inline [hooks] of its own, are a warning', () => {
  const { dataDir, toml } = fresh();
  fs.mkdirSync(path.dirname(toml), { recursive: true });
  const text = 'model = "gpt-5.5"\n\n[features]\nhooks = false # for now\n';
  fs.writeFileSync(toml, text);
  const r = codex.install(opts(dataDir));
  assert.match(r.warning, /turned off/);
  assert.match(codex.status().warning, /turned off/);
  assert.equal(fs.readFileSync(toml, 'utf8'), text, 'config.toml untouched');
  assert.equal(fs.readdirSync(path.dirname(toml)).filter((f) => f.startsWith('config.toml.')).length, 0, 'no backup of it either');
  fs.writeFileSync(toml, '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "notify-send done"\n');
  assert.match(codex.status().warning, /\[hooks\] of its own/);
  fs.writeFileSync(toml, 'model = "gpt-5.5"\n');
  assert.equal(codex.status().warning, undefined);
});

test('scanConfig: when hooks are off', () => {
  const off = (text) => codex.scanConfig(text).disabled;
  assert.equal(off('[features]\nhooks = false\n'), true);
  assert.equal(off('[features]\ncodex_hooks = false\n'), true, 'the deprecated name');
  assert.equal(off('[ features ]\n"hooks" = false\n'), true);
  assert.equal(off('features.hooks = false\n'), true);
  assert.equal(off('features = { hooks = false, web_search = true }\n'), true);
  assert.equal(off('[features]\nhooks = true\ncodex_hooks = false\n'), false, 'the new name wins');
  assert.equal(off('[features]\nhooks = true\n'), false);
  assert.equal(off('[features]\n# hooks = false\n'), false, 'a comment');
  assert.equal(off('[profiles.work.features]\nhooks = false\n'), false, 'a profile, not the default');
  assert.equal(off('[other]\nhooks = false\n'), false);
  assert.equal(off('[features]\nweb_search = true\n[tui]\nhooks = false\n'), false, 'another table');
  assert.equal(off('instructions = """\n[features]\nhooks = false\n"""\n'), false, 'inside a multi-line string');
  assert.equal(off("note = '''\n[features]\nhooks = false\n'''\n[features]\nhooks = true\n"), false);
  assert.equal(off('notify = [\n  "a",\n  ["b"]\n]\n[features]\nhooks = false\n'), true, 'after a multi-line array');
  assert.equal(off(''), false);
});

test('scanConfig: inline [hooks] tables', () => {
  const inline = (text) => codex.scanConfig(text).inline;
  assert.equal(inline('[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n'), true);
  assert.equal(inline('[hooks]\n'), true);
  assert.equal(inline('hooks.Stop = []\n'), true);
  assert.equal(inline('[features]\nhooks = true\n'), false, 'the feature flag is no hook');
  assert.equal(inline('description = "see [hooks] in the docs"\n'), false, 'in a string');
  assert.equal(inline('# [[hooks.Stop]]\n'), false, 'in a comment');
  assert.equal(inline('instructions = """\n[[hooks.Stop]]\n"""\n'), false, 'inside a multi-line string');
  assert.equal(inline('matrix = [\n  [1, 2]\n]\n'), false);
});

test('tomlLines: comments and strings out of the way, escaped quotes too', () => {
  const lines = (text) => codex.tomlLines(text).filter(Boolean);
  assert.deepEqual(lines('a = "x # y" # z\nb = \'#\'\n'), ['a = ""', 'b = ""']);
  assert.deepEqual(lines('a = "say \\"[hooks]\\"" \n'), ['a = ""']);
  assert.deepEqual(lines('a = """one\ntwo"""\nb = 1'), ['a = ""', 'b = 1']);
  assert.deepEqual(lines('"hooks" = 1\n'), ['hooks = 1'], 'a quoted key stays a key');
});
