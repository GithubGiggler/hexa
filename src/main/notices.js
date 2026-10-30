'use strict';

// Desktop notifications for what Claude does while Hexa can't tell you herself: she's in the
// background, or Do Not Disturb is on (the server then files them quietly in its history).
// Claude needs you, a job is done, a command failed. Each has one button, Show, which brings her
// back. There is never a button that answers Claude: approving stays in Claude or on her (spec §7.4).

const path = require('node:path');
const { clean } = require('./text');

const ALERTS = {
  permission_prompt: 'needs you',
  elicitation_dialog: 'has a question',
  elicitation_url_dialog: 'has a question',
  agent_needs_input: 'needs you',
};
const NAMES = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' };
const SHOW = [{ id: 'show', label: 'Show' }];
const MAX_SESSIONS = 64;

const nameOf = (evt) => NAMES[evt.assistant] || 'Claude';
const projectOf = (evt) => (typeof evt.cwd === 'string' && evt.cwd ? clean(path.basename(evt.cwd), 60) : '');
const joined = (...parts) => parts.filter(Boolean).join(': ');

// The notification an event is worth while she's away, or null. Bodies keep to the project and a
// short label (no reply text): notifications can show on a lock screen.
function noticeFor(evt) {
  if (!evt || evt.demo || typeof evt.hook_event_name !== 'string') return null;
  const project = projectOf(evt);
  switch (evt.hook_event_name) {
    case 'Notification': {
      const what = ALERTS[evt.notification_type];
      if (!what) return null;
      return { kind: 'alert', title: `${nameOf(evt)} ${what}`, body: joined(project, clean(evt.message, 160)) };
    }
    case 'Stop':
      return { kind: 'done', title: `${nameOf(evt)} is done`, body: project };
    case 'PostToolUseFailure': {
      if (evt.tool_name !== 'Bash' || evt.is_interrupt) return null; // you stopped it: you know
      const input = evt.tool_input && typeof evt.tool_input === 'object' ? evt.tool_input : {};
      return { kind: 'failed', title: 'A command failed', body: joined(project, clean(input.description || input.command, 100)) };
    }
    default:
      return null;
  }
}

// notify: notifications.js's. away(): true while she's in the background or Do Not Disturb is on.
// follows(evt): is it the assistant she watches (the others' news isn't hers to bring you)?
function createNotices({ notify, away, follows = () => true }) {
  const last = new Map(); // session -> its notification, so its newer news replaces the older

  async function see(evt) {
    const session = String(evt?.session_id || 'default');
    if (evt?.hook_event_name === 'SessionEnd') last.delete(session);
    if (!away() || !follows(evt)) return null;
    const n = noticeFor(evt);
    if (!n) return null;
    // normal urgency, even for "needs you": a critical one would break through Do Not Disturb
    const id = await notify({ title: n.title, body: n.body, urgency: 'normal', actions: SHOW, defaultAction: 'show', replaces: last.get(session) || 0 });
    if (id) {
      last.delete(session);
      last.set(session, id);
      if (last.size > MAX_SESSIONS) last.delete(last.keys().next().value);
    }
    return id;
  }

  return { see };
}

module.exports = { noticeFor, createNotices };
