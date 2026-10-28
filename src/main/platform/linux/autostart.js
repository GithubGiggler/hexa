'use strict';

// Start at login, the XDG way: a desktop entry in ~/.config/autostart/. KDE, GNOME, Xfce and the
// rest all read it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function file() {
  const base = process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME)
    ? process.env.XDG_CONFIG_HOME
    : path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', 'hexa.desktop');
}

// Desktop Entry spec: each argument quoted, with ", `, $ and \ escaped, and % doubled.
const quote = (arg) => `"${String(arg).replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`;

function enable({ exec, args = [] }) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Hexa',
    'Comment=Your desktop daemon, narrating Claude Code',
    `Exec=${[exec, ...args].map(quote).join(' ')}`,
    'Icon=hexa',
    'Terminal=false',
    'Categories=Utility;',
    'X-GNOME-Autostart-enabled=true',
    'X-KDE-autostart-phase=2',
  ];
  fs.writeFileSync(target, lines.join('\n') + '\n');
}

function disable() {
  fs.rmSync(file(), { force: true });
}

function isEnabled() {
  try {
    return !/^Hidden=true$/m.test(fs.readFileSync(file(), 'utf8'));
  } catch {
    return false;
  }
}

module.exports = { file, enable, disable, isEnabled };
