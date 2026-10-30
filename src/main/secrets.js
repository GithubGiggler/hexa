'use strict';

// Your Claude API key, if you give her one: encrypted with the desktop's keyring (Electron's
// safeStorage: KWallet, GNOME Keyring...) in ~/.config/hexa/claude-key.bin, readable only by you.
// Without a keyring it refuses to store it: set ANTHROPIC_API_KEY or run `ant auth login` instead,
// which the Anthropic SDK finds by itself.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

function createSecrets({ safe = require('electron').safeStorage, dir = paths.configDir() } = {}) {
  const file = path.join(dir, 'claude-key.bin');
  const keyringOk = () => safe.isEncryptionAvailable() && safe.getSelectedStorageBackend?.() !== 'basic_text';
  return {
    keyringOk,
    has: () => fs.existsSync(file),
    save(key) {
      const k = String(key || '').trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(k)) throw new Error('That doesn\'t look like an Anthropic API key (sk-ant-…).');
      if (!keyringOk()) throw new Error('No keyring to keep it safe in: set ANTHROPIC_API_KEY, or run `ant auth login`, instead.');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, safe.encryptString(k), { mode: 0o600 });
      fs.renameSync(temp, file);
    },
    load() {
      try {
        return fs.existsSync(file) ? safe.decryptString(fs.readFileSync(file)) : null;
      } catch {
        return null;
      }
    },
    clear() {
      fs.rmSync(file, { force: true });
    },
  };
}

module.exports = { createSecrets };
