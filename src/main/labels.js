'use strict';

// The tray menu (and the one she opens when you right-click her). English for now; the other
// languages arrive in M4 and fall back to these strings for anything missing.

const TRAY = {
  en: {
    name: 'English',
    online: 'Hexa: online',
    hide: 'Send to background',
    show: 'Bring her back',
    talk: 'Talk to me',
    teleport: 'Teleport',
    lurk: 'Watch my window',
    fork: 'Fork',
    demo: 'Play demo',
    help: 'How does it work?',
    stats: 'Usage and stats',
    size: 'Size',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    sound: 'Sound',
    mute: 'Mute',
    soundsDir: 'Open custom sounds folder',
    wander: 'Wander around when idle',
    possess: 'Possess my windows',
    screen: 'Screen',
    follow: 'Follow me across screens',
    startup: 'Start at login',
    // whose work she follows, and its hooks ({name}: one of the three below)
    watch: 'Watch',
    watchClaude: 'Claude Code',
    watchCodex: 'Codex',
    watchAgy: 'Antigravity',
    hooksOn: '{name} hooks: installed',
    hooksOff: 'Install {name} hooks',
    hooksRemove: 'Remove {name} hooks',
    permissions: 'Answer permissions from Hexa',
    hooksBroken: '{name} settings: {error}',
    compositor: 'Transparency needs a compositor (KWin: Alt+Shift+F12)',
    quit: 'Quit',
  },
};

function trayLabels(lang) {
  return { ...TRAY.en, ...(TRAY[lang] || {}) };
}

module.exports = { TRAY, LANGS: Object.keys(TRAY), trayLabels };
