'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const autostart = require('../src/main/platform/linux/autostart');

function fresh() {
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-auto-'));
}

test('enable writes a desktop entry with a quoted Exec, disable removes it', () => {
  fresh();
  assert.equal(autostart.file(), path.join(process.env.XDG_CONFIG_HOME, 'autostart', 'hexa.desktop'));
  assert.equal(autostart.isEnabled(), false);
  autostart.enable({ exec: '/opt/Hexa/hexa', args: ['--hidden'] });
  const text = fs.readFileSync(autostart.file(), 'utf8');
  assert.match(text, /^\[Desktop Entry\]$/m);
  assert.match(text, /^Type=Application$/m);
  assert.match(text, /^Name=Hexa$/m);
  assert.match(text, /^Exec="\/opt\/Hexa\/hexa" "--hidden"$/m);
  assert.match(text, /^X-GNOME-Autostart-enabled=true$/m);
  assert.equal(autostart.isEnabled(), true);
  autostart.disable();
  assert.equal(autostart.isEnabled(), false);
  autostart.disable(); // twice is fine
});

test('Exec escaping follows the Desktop Entry spec', () => {
  fresh();
  autostart.enable({ exec: '/home/u/My Apps/Hexa "beta".AppImage', args: ['--x=100%', '$HOME'] });
  const exec = /^Exec=(.*)$/m.exec(fs.readFileSync(autostart.file(), 'utf8'))[1];
  assert.equal(exec, '"/home/u/My Apps/Hexa \\"beta\\".AppImage" "--x=100%%" "\\$HOME"');
});
