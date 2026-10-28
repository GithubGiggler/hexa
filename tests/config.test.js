'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../src/main/config');

// a fresh config dir for each test
function fresh() {
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-cfg-'));
  return path.join(process.env.XDG_CONFIG_HOME, 'hexa');
}

test('missing file gives defaults', () => {
  fresh();
  assert.deepEqual(config.load(true), config.DEFAULTS);
});

test('save merges, persists and keeps unknown keys', () => {
  const dir = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), '{"future":1}');
  config.load(true);
  const saved = config.save({ scale: 1.25 });
  assert.equal(saved.scale, 1.25);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(disk.future, 1);
  assert.equal(disk.scale, 1.25);
  assert.equal(disk.muted, false);
});

test('corrupt file is moved aside and defaults load', () => {
  const dir = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), '{nope');
  assert.deepEqual(config.load(true), config.DEFAULTS);
  const aside = fs.readdirSync(dir).filter((f) => /^config\.json\.corrupt-\d+$/.test(f));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{nope');
});

test('save is atomic: no temp file left behind', () => {
  const dir = fresh();
  config.load(true);
  config.save({ muted: true });
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('defaults are the M1 set', () => {
  assert.deepEqual(config.DEFAULTS, {
    configVersion: 1, scale: 1, muted: false, volume: 0.7, lang: 'auto', displayId: null, wander: true,
    visible: true, welcomed: false, linked: false, claude: true, motion: 'auto', shortcut: 'Ctrl+Alt+H',
    startAtLogin: false, tcp: false,
  });
});
