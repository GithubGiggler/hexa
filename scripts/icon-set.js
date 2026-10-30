'use strict';

// electron-builder wants Linux icons named by their size (16x16.png, 22x22.png...). Hexa's live in
// assets/icons/ as hexa-<size>.png, so this copies them to build/icons/ (git-ignored) under those
// names. electron-builder runs it as its beforeBuild hook; `node scripts/icon-set.js` does it by hand.

const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];
const root = path.join(__dirname, '..');

function makeIconSet() {
  const out = path.join(root, 'build', 'icons');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const size of SIZES) {
    fs.copyFileSync(path.join(root, 'assets', 'icons', `hexa-${size}.png`), path.join(out, `${size}x${size}.png`));
  }
  return out;
}

// As a hook it must resolve to true: anything else tells electron-builder that node_modules are
// handled elsewhere, and it then ships the app without them.
module.exports = async function beforeBuild() {
  makeIconSet();
  return true;
};

if (require.main === module) console.log(makeIconSet());
