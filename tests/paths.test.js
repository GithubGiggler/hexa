'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../src/main/paths');

const XDG = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'HEXA_SOCKET'];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(XDG.map((k) => [k, process.env[k]]));
  for (const k of XDG) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    fn();
  } finally {
    for (const k of XDG) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('XDG variables win', () => {
  withEnv({ XDG_CONFIG_HOME: '/x/c', XDG_DATA_HOME: '/x/d', XDG_STATE_HOME: '/x/s', XDG_RUNTIME_DIR: '/x/r' }, () => {
    assert.equal(paths.configDir(), '/x/c/hexa');
    assert.equal(paths.dataDir(), '/x/d/hexa');
    assert.equal(paths.stateDir(), '/x/s/hexa');
    assert.equal(paths.runtimeDir(), '/x/r/hexa');
    assert.equal(paths.socketPath(), '/x/r/hexa/hexa.sock');
  });
});

test('fallbacks without XDG variables', () => {
  withEnv({}, () => {
    const h = os.homedir();
    assert.equal(paths.configDir(), path.join(h, '.config/hexa'));
    assert.equal(paths.dataDir(), path.join(h, '.local/share/hexa'));
    assert.equal(paths.stateDir(), path.join(h, '.local/state/hexa'));
    assert.equal(paths.socketPath(), path.join(h, '.cache/hexa/hexa.sock'));
  });
});

test('HEXA_SOCKET overrides the socket path', () => {
  withEnv({ XDG_RUNTIME_DIR: '/x/r', HEXA_SOCKET: '/tmp/t.sock' }, () => {
    assert.equal(paths.socketPath(), '/tmp/t.sock');
  });
});

test('ensurePrivateDir makes and fixes 0700', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-')), 'a/b');
  assert.equal(paths.ensurePrivateDir(dir), dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.chmodSync(dir, 0o755);
  paths.ensurePrivateDir(dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
});
