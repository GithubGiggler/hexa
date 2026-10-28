'use strict';

// Where Hexa keeps things, the XDG way. Every function reads the environment when called,
// so tests (and users with unusual setups) can move any of them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = 'hexa';

function base(variable, fallback) {
  const value = process.env[variable];
  // the XDG spec says relative paths are invalid and must be ignored
  return value && path.isAbsolute(value) ? value : path.join(os.homedir(), fallback);
}

const configDir = () => path.join(base('XDG_CONFIG_HOME', '.config'), APP);
const dataDir = () => path.join(base('XDG_DATA_HOME', '.local/share'), APP);
const stateDir = () => path.join(base('XDG_STATE_HOME', '.local/state'), APP);

// The runtime dir is per-user and private (0700) by spec; without one, a private cache dir.
function runtimeDir() {
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime && path.isAbsolute(runtime) ? path.join(runtime, APP) : path.join(os.homedir(), '.cache', APP);
}

function socketPath() {
  return process.env.HEXA_SOCKET || path.join(runtimeDir(), `${APP}.sock`);
}

// Creates dir (and its parents) readable only by you, and tightens it if it already exists.
function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

module.exports = { configDir, dataDir, stateDir, runtimeDir, socketPath, ensurePrivateDir };
