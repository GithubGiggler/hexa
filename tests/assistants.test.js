'use strict';

// src/main/hooks/index.js: the three assistants behind one face, each on its own temporary home.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assistants = require('../src/main/hooks');

const APP = path.join(__dirname, '..');

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-assist-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.HEXA_GEMINI_DIR = path.join(root, 'gemini');
  return { root, dataDir: path.join(root, 'data') };
}

test('assistantOf: the three names, a few aliases, nothing else', () => {
  assert.equal(assistants.assistantOf('claude'), 'claude');
  assert.equal(assistants.assistantOf(' Codex '), 'codex');
  assert.equal(assistants.assistantOf('agy'), 'agy');
  assert.equal(assistants.assistantOf('Antigravity'), 'agy');
  assert.equal(assistants.assistantOf('claude-code'), 'claude');
  for (const bad of ['cursor', '', null, undefined, 3, {}, '__proto__', 'constructor']) assert.equal(assistants.assistantOf(bad), null, String(bad));
  assert.deepEqual(assistants.ASSISTANTS, ['claude', 'codex', 'agy']);
});

test('ownerOf: whose event, from its session’s mark', () => {
  assert.equal(assistants.ownerOf({ session_id: 'codex:th-1' }), 'codex');
  assert.equal(assistants.ownerOf({ session_id: 'agy:ec33' }), 'agy');
  assert.equal(assistants.ownerOf({ session_id: '6f0c2a' }), 'claude');
  assert.equal(assistants.ownerOf({ session_id: 'xcodex:1' }), 'claude');
  assert.equal(assistants.ownerOf({}), 'claude');
  assert.equal(assistants.ownerOf(null), 'claude');
});

test('install, status and uninstall go to each assistant’s own file, and only there', () => {
  const { root, dataDir } = fresh();
  const files = {};
  for (const a of assistants.ASSISTANTS) {
    assert.equal(assistants.status(a).installed, false, a);
    const r = assistants.install(a, { appDir: APP, dataDir, hasNode: true });
    files[a] = r.file;
    assert.ok(r.file.startsWith(root), `${a}: ${r.file}`);
    assert.equal(assistants.status(a).installed, true, a);
  }
  assert.deepEqual(files, {
    claude: path.join(root, 'claude', 'settings.json'),
    codex: path.join(root, 'codex', 'hooks.json'),
    agy: path.join(root, 'gemini', 'config', 'hooks.json'),
  });
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'hooks')).sort(), ['hexa-agy-hook.js', 'hexa-codex-hook.js', 'hexa-hook.js']);
  assert.equal(assistants.uninstall('codex').removed, true);
  assert.equal(assistants.status('codex').installed, false);
  assert.equal(assistants.status('claude').installed, true, 'the others keep theirs');
  assert.equal(assistants.status('agy').installed, true);
  assert.equal(assistants.status('Antigravity').installed, true);
});

test('an assistant it doesn’t know: an error, and nothing written', () => {
  const { root, dataDir } = fresh();
  assert.throws(() => assistants.install('cursor', { appDir: APP, dataDir, hasNode: true }), /no hooks for "cursor"/);
  assert.throws(() => assistants.status('cursor'), /no hooks/);
  assert.throws(() => assistants.uninstall(undefined), /no hooks/);
  assert.deepEqual(fs.readdirSync(root), []);
});
