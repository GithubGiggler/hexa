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

// What "Always allow" would allow, all of it, and where it's saved: "Bash(npm test:*) (saved to
// localSettings)", "acceptEdits mode (saved to session)"...
function describeAlways(s) {
  if (!s || typeof s !== 'object') return '';
  let what = '';
  if (Array.isArray(s.rules) && s.rules.length) {
    what = s.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r.toolName || ''))).join(', ');
  } else if (s.type === 'setMode' && s.mode) what = `${s.mode} mode`;
  else if (Array.isArray(s.directories)) what = s.directories.join(', ');
  return what && s.destination ? `${what} (saved to ${s.destination})` : what;
}

// The whole of what you'd approve, as text: a command itself (never the description Claude wrote
// for it), a path with what goes in it, a URL, or the tool's input as JSON.
function detailOf(tool, input = {}) {
  const str = (v) => (typeof v === 'string' ? v : '');
  if (tool === 'Bash') return str(input.command);
  if (tool === 'WebFetch') return [str(input.url), str(input.prompt)].filter(Boolean).join('\n');
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const path = str(input.file_path) || str(input.notebook_path);
    if (tool === 'Write') return `${path}\n\n${str(input.content)}`;
    if (tool === 'Edit') return `${path}\n\n- ${str(input.old_string)}\n+ ${str(input.new_string)}`;
    return `${path}\n\n${JSON.stringify(input.edits ?? input, null, 2)}`;
  }
  return JSON.stringify(input, null, 2);
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
          detail: detailOf(String(ask.tool_name || ''), ask.tool_input && typeof ask.tool_input === 'object' ? ask.tool_input : {}),
          // the hook says the whole request is there; a request that doesn't say so isn't
          complete: ask.complete === true,
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

module.exports = { createPermissions, clampWait, describeAlways, detailOf };
