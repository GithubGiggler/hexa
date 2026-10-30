'use strict';

// Answering Claude Code's permission requests from her (opt-in). A request comes from the
// PermissionRequest hook over the bridge and waits; she shows a card; your click on it, and only
// that, answers. Each request has an id that answers once. No answer in time, the hook hanging up
// first, or her not offering at all (background, Do Not Disturb, you're away) all mean no decision:
// the hook prints nothing and Claude asks you as usual.

const crypto = require('node:crypto');
const path = require('node:path');

const CHOICES = {
  allow: { behavior: 'allow' },
  always: { behavior: 'allow', always: true },
  deny: { behavior: 'deny' },
  ask: { behavior: null },
};
const NONE = { behavior: null };

// seconds from settings to milliseconds, 5 to 60, 10 by default
function clampWait(seconds) {
  const s = Number(seconds);
  return Math.round(Math.min(60, Math.max(5, Number.isFinite(s) ? s : 10)) * 1000);
}

// What "Always allow" would allow, in a few words: "Bash(npm test)", "acceptEdits mode"...
function describeAlways(s) {
  if (!s || typeof s !== 'object') return '';
  if (Array.isArray(s.rules) && s.rules.length) {
    return s.rules.slice(0, 3).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r.toolName || ''))).join(', ');
  }
  if (s.type === 'setMode' && s.mode) return `${s.mode} mode`;
  if (Array.isArray(s.directories)) return s.directories.slice(0, 2).join(', ');
  return '';
}

function createPermissions({ offer, show, hide, waitMs = () => 10000, timers = { setTimeout, clearTimeout } }) {
  const pending = new Map(); // id -> { resolve, timer }

  const settle = (id, answer, { gone = false } = {}) => {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    timers.clearTimeout(p.timer);
    if (gone) hide(id);
    p.resolve(answer);
    return true;
  };

  return {
    request(ask, { onClose }) {
      if (!offer(ask)) return Promise.resolve(NONE);
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => settle(id, NONE, { gone: true }), waitMs());
        pending.set(id, { resolve, timer });
        onClose(() => settle(id, NONE, { gone: true }));
        const always = describeAlways(ask.always);
        show({
          id,
          session_id: String(ask.session_id || ''),
          cwd: String(ask.cwd || ''),
          project: ask.cwd ? path.basename(String(ask.cwd)) : '',
          tool_name: String(ask.tool_name || ''),
          tool_input: ask.tool_input && typeof ask.tool_input === 'object' ? ask.tool_input : {},
          canAlways: Boolean(always),
          always,
          waitMs: waitMs(),
        });
      });
    },

    // your click on her card (the renderer only sends it from a real click)
    answer(id, choice) {
      if (!Object.hasOwn(CHOICES, choice)) return false;
      return settle(id, CHOICES[choice]);
    },

    get size() {
      return pending.size;
    },
  };
}

module.exports = { createPermissions, clampWait, describeAlways };
