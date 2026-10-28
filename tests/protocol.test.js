'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveHexaUrl } = require('../src/main/protocol');

const dirs = { appDir: '/opt/hexa/app', dataDir: '/home/u/.local/share/hexa' };

test('app files resolve under the app folder', () => {
  assert.equal(resolveHexaUrl('hexa://app/src/renderer/index.html', dirs), '/opt/hexa/app/src/renderer/index.html');
  assert.equal(resolveHexaUrl('hexa://app/packs/hexa/pack.json', dirs), '/opt/hexa/app/packs/hexa/pack.json');
});

test('sounds and packs resolve under the data folder', () => {
  assert.equal(resolveHexaUrl('hexa://sounds/done.ogg', dirs), path.join(dirs.dataDir, 'sounds', 'done.ogg'));
  assert.equal(resolveHexaUrl('hexa://sounds/my%20done.ogg', dirs), path.join(dirs.dataDir, 'sounds', 'my done.ogg'));
  assert.equal(resolveHexaUrl('hexa://packs/neko/pack.json', dirs), path.join(dirs.dataDir, 'packs', 'neko', 'pack.json'));
});

test('nothing escapes its folder', () => {
  for (const url of [
    'hexa://app/../../etc/passwd',
    'hexa://app/src/../../../etc/passwd',
    'hexa://sounds/%2e%2e%2fconfig.json',
    'hexa://sounds/..%2F..%2F.ssh%2Fid_ed25519',
    'hexa://packs/../../../etc/shadow',
    'hexa://packs/neko/%2e%2e/%2e%2e/x',
    'hexa://sounds/%00done.ogg',
  ]) assert.equal(resolveHexaUrl(url, dirs), null, url);
});

test('unknown hosts and other schemes are refused', () => {
  assert.equal(resolveHexaUrl('hexa://etc/passwd', dirs), null);
  assert.equal(resolveHexaUrl('file:///etc/passwd', dirs), null);
  assert.equal(resolveHexaUrl('hexa://sounds/', dirs), null);
});
