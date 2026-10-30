// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.

// Showing you around: short scenes where she goes places, points at things and explains. Each
// scene is panels with buttons; a panel that can't show (an alert is up) or that you close ends
// the scene. Her words are in lines/en.js (GUIDE).

import { fmt } from './util.js';

export class Guide {
  constructor({ hexa, panel, host, brain, lines, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.hexa = hexa;
    this.panel = panel;
    this.host = host;
    this.brain = brain;
    this.lines = lines;
    this.wait = wait;
  }

  get g() {
    return this.lines().guide;
  }

  ok() {
    return [{ id: 'ok', label: this.g.ok, primary: true }];
  }

  // One panel; resolves with the id of the button you click, or null if it went away.
  ask({ kind = 'info', face = 'calm', line, quote = '', actions }) {
    return new Promise((resolve) => {
      const shown = this.panel.say({ kind, face, line, quote, actions, hold: null, onAction: resolve, onDismiss: () => resolve(null) });
      if (!shown) resolve(null);
    });
  }

  async welcome() {
    const g = this.g;
    const id = await this.ask({
      face: 'laugh', line: g.welcomeHi, quote: g.welcomeWhat,
      actions: [{ id: 'connect', label: g.plugIn, primary: true }, { id: 'later', label: g.justHang }],
    });
    if (id === 'connect') await this.connect();
  }

  async menu() {
    const g = this.g;
    const hooks = await this.host.hooksStatus().catch(() => ({ installed: false }));
    const actions = [];
    if (!hooks.installed) actions.push({ id: 'connect', label: g.topics.connect, primary: true });
    actions.push({ id: 'claude', label: g.topics.claude, primary: Boolean(hooks.installed) });
    actions.push({ id: 'folder', label: g.topics.folder });
    actions.push({ id: 'icon', label: g.topics.icon });
    actions.push({ id: 'close', label: g.topics.close });
    const id = await this.ask({ face: 'smug', line: g.menuLine, actions });
    if (id === 'connect') return this.connect();
    if (id === 'claude') return this.claude();
    if (id === 'folder') return this.folder();
    if (id === 'icon') return this.icon();
    return undefined;
  }

  async connect() {
    const g = this.g;
    const r = await this.host.installHooks().catch((err) => ({ ok: false, error: err.message }));
    if (r?.ok) await this.ask({ kind: 'done', face: 'laugh', line: g.connected, quote: g.restart, actions: this.ok() });
    else await this.ask({ kind: 'error', face: 'dead', line: fmt(g.hooksFailed, { error: r?.error || '?' }), actions: this.ok() });
  }

  async claude() {
    const g = this.g;
    const win = this.brain.claudeWindow();
    if (!win || !this.hexa.canPoint(win)) {
      await this.ask({ face: 'ask', line: g.claudeUnknown, actions: this.ok() });
      return;
    }
    await this.hexa.pointAt(win, { label: 'CLAUDE' });
    await this.ask({ face: 'smug', line: g.claudeHere, actions: this.ok() });
    this.hexa.stopPointing();
  }

  async folder() {
    const g = this.g;
    const before = new Set(this.brain.windows.wins.map((w) => w.id));
    await this.host.openClaudeFolder();
    const win = await this.newWindow(before, 4000);
    if (win) await this.hexa.pointAt(win, { label: '~/.claude' });
    await this.ask({ face: 'smug', line: g.folderLine, quote: g.folderHow, actions: this.ok() });
    this.hexa.stopPointing();
  }

  async icon() {
    const g = this.g;
    const r = await this.host.trayPlace().catch(() => null);
    if (!r) {
      await this.ask({ face: 'ask', line: g.iconNone, actions: this.ok() });
      return;
    }
    await this.hexa.pointAt({ x: r[0], y: r[1], w: r[2], h: r[3] }, { label: 'HEXA' });
    await this.ask({ face: 'smug', line: g.iconLine, actions: this.ok() });
    this.hexa.stopPointing();
  }

  // The first window that wasn't there before, as it shows up (the file manager she opened).
  async newWindow(before, ms) {
    for (let waited = 0; waited <= ms; waited += 100) {
      const win = this.brain.windows.wins.find((w) => !before.has(w.id));
      if (win) return win;
      await this.wait(100);
    }
    return null;
  }
}
