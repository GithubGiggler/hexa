'use strict';

// Hexa's settings, in ~/.config/hexa/config.json. Saved atomically (a temp file renamed into
// place) so a crash mid-write can't leave half a file; a file we can't read is kept aside, not lost.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const DEFAULTS = {
  configVersion: 1,
  scale: 1,            // her size: 0.8 small, 1 medium, 1.25 large
  muted: false,
  volume: 0.7,
  lang: 'auto',        // 'auto' follows LANG
  displayId: null,     // null: the primary display
  follow: true,        // she follows your pointer to another screen after a few seconds
  wander: true,        // she drifts around when nothing's going on
  possess: true,       // now and then she dives into the window she sits on and takes it over
  visible: true,       // false: she's in the background (just her core)
  welcomed: false,     // she has introduced herself
  linked: false,       // a real Claude Code event has reached her at least once
  claude: true,        // she watches Claude Code (off: she just keeps you company)
  motion: 'auto',      // 'auto' (like the desktop's animation setting), 'full' or 'reduced'
  shortcut: 'Ctrl+Alt+H',
  startAtLogin: false,
  tcp: false,          // also listen on 127.0.0.1:47823 (with a token), for tools that can't use the socket
  permissionWait: 10,  // seconds her permission card waits for your click (5 to 60), then Claude asks as usual
  brain: 'normal',     // her brain when you talk to her: 'normal' / 'bigger' (local, Ollama) or 'max' (Claude)
  brainModels: {},     // the model picked for each brain; unset: the smallest / biggest local one, Claude Opus 5.5
  computerUse: false,  // she may use your mouse and keyboard for a task you ask (Claude only, asks first every time)
};

let cache = null;

const file = () => path.join(paths.configDir(), 'config.json');

function load(fresh = false) {
  if (cache && !fresh) return cache;
  const target = file();
  let text = null;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch {
    // no file yet: defaults
  }
  if (text === null) {
    cache = { ...DEFAULTS };
    return cache;
  }
  try {
    cache = { ...DEFAULTS, ...JSON.parse(text) };
  } catch (err) {
    const aside = `${target}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(target, aside);
    } catch {
      // can't move it: we just won't read it
    }
    console.error(`[hexa] ${target} could not be read (${err.message}); kept it as ${aside} and started from defaults`);
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  const target = file();
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n');
    fs.renameSync(temp, target);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    console.error('[hexa] could not save config:', err.message);
  }
  return cache;
}

module.exports = { DEFAULTS, file, load, save };
