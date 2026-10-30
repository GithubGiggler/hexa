// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.

// Turns Claude Code hook events into things Hexa says and does. No timers in here: app.js calls
// tick() once a second, so the quiet-time rules can be tested with a fake clock.

import { linesFor } from './lines/index.js';
import { describeTool } from './labels.js';
import { pick, fmt, clip, basename, duration, plural } from './util.js';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const HACKING_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Task']);
const ALERTS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
const WORKING_EVERY = 20; // say something about progress every N tool calls
// mid-task with not a word from Claude: this long and the ticker starts counting (it's thinking),
// this long and she says something about it, this long and she tells you nothing's stuck
const THINK_AFTER = 15000;
const THINK_SAY = 40000;
const THINK_LONG = 120000;
// a session with no events at all for this long is gone (closed terminal, killed process): no
// SessionEnd ever comes, so it stops counting as working
const STALE_MS = 30 * 60 * 1000;
// pointing at a session's window, after a click on its chip in the HUD
const FOCUS_POINT_MS = 6000;
// another AI's window in front: she notices after this long, and at most this often
const JEALOUS_AFTER_MS = 20000;
const JEALOUS_EVERY_MS = 10 * 60 * 1000;
// ticks come every second; a gap this long means the machine slept or the page froze
const TICK_GAP_MS = 120000;
const LINKED_HOLD_MS = 5000;
// a job this small doesn't get the whole victory, just a word
const BIG_JOB_ACTIONS = 3;
const BIG_JOB_MS = 20000;
// a long job deserves her Fork after the victory
const FORK_JOB_ACTIONS = 50;
const FORK_JOB_MS = 8 * 60 * 1000;

// "Exit code 1" says nothing; the line that names the problem usually does.
export function firstErrorLine(text) {
  const lines = String(text || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const telling = lines.find((l) => /error|failed|exception|not found|denied|cannot/i.test(l) && !/^exit code \d+$/i.test(l));
  return clip(telling || lines.at(-1) || '', 120);
}

// The last sentence of Claude's answer, without its markdown, for the end-of-job panel.
function lastSentence(text) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]*/g) || [];
  return clip((sentences.map((s) => s.trim()).filter(Boolean).at(-1)) || '', 150);
}

export class Brain {
  constructor({ hexa, panel, voice, lang = 'en', assistant = 'claude', now = Date.now }) {
    this.hexa = hexa;
    this.panel = panel;
    this.voice = voice;
    this.lang = lang;
    this.assistant = assistant; // 'claude', 'codex' or 'agy': whose events she follows
    this.now = now;
    this.sessions = new Map();
    this.linked = true;     // has a real event ever reached her (app.js sets it from the config)
    this.onLinked = null;
    this.watching = true;   // she follows Claude Code (off: she just keeps you company)
    this.userName = '';
    this.thinking = null;   // { s, since, said } while Claude is quiet mid-task
    this.windows = { fg: 0, wins: [] }; // the latest window snapshot (main process)
    this.replyFor = null;   // the session whose whole answer she's holding up for you
    this.lastTick = null;
    this.linkedAt = null;   // when she said she can see Claude (her first real event)
  }

  get t() {
    return linesFor(this.lang);
  }

  get name() {
    return { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' }[this.assistant] || 'Claude';
  }

  // Whose session it is: Codex's and Antigravity's hooks mark theirs (codex:..., agy:...).
  static ownerOf(sessionId) {
    return /^(codex|agy):/.exec(String(sessionId || ''))?.[1] || 'claude';
  }

  // She starts following another assistant (her menu's Watch): what she knew of the other one's
  // sessions goes, so a job it left running doesn't keep her at work.
  watch(assistant) {
    if (assistant === this.assistant) return;
    this.assistant = assistant;
    for (const [id, s] of this.sessions) {
      if (Brain.ownerOf(id) === assistant) continue;
      this.sessions.delete(id);
      if (s.waiting) {
        this.hexa.markWaiting?.(false);
        this.panel.clearKind('alert');
      }
      if (s.pointedAt) this.hexa.stopPointing?.();
      if (this.replyFor === s) {
        this.replyFor = null;
        this.panel.clearKind('done');
      }
    }
    this.thinking = null;
    if (this.hexa.mode === 'alert' || this.hexa.alerting) this.hexa.setMode('idle');
    this.settle();
  }

  vars(s, extra = {}) {
    return { name: this.name, project: s?.project || this.name, user: this.userName || 'there', ...extra };
  }

  line(key, s, extra) {
    return fmt(pick(this.t[key]), this.vars(s, extra));
  }

  session(evt) {
    const id = evt.session_id || 'default';
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, project: this.name, taskStart: null, count: 0, files: new Set(), working: false, waiting: false, last: null };
      this.sessions.set(id, s);
    }
    if (evt.cwd) s.project = basename(evt.cwd);
    // the main process found the window the hook's process tree belongs to: Claude's
    if (evt.window_id) s.window = evt.window_id;
    if (evt.session_title) s.title = evt.session_title;
    s.seen = this.now();
    return s;
  }

  get busySessions() {
    return [...this.sessions.values()].filter((s) => s.working);
  }

  say(kind, line, s, extra = {}) {
    // "I can see Claude!" is said once ever: the chatter right after it doesn't get to wipe it
    if (this.linkedAt !== null && this.now() - this.linkedAt < LINKED_HOLD_MS && (kind === 'info' || kind === 'work')) return null;
    return this.panel.say({ kind, line, tag: s ? s.title || s.project : '', ...extra });
  }

  settle() {
    if (this.busySessions.length) return;
    this.panel.setTicker(null);
    this.hexa.setMode('idle');
  }

  handle(evt) {
    // Codex's and Antigravity's hooks mark their sessions (codex:..., agy:...): only the one she watches counts
    if (!evt.demo && Brain.ownerOf(evt.session_id) !== this.assistant) return undefined;
    if (!this.watching && !evt.demo) return undefined;
    const s = this.session(evt);
    // the first real event that ever reaches her (the demo's don't count)
    if (!this.linked && !evt.demo) {
      this.linked = true;
      this.onLinked?.();
      this.say('info', this.line('linked', s), s, { face: 'laugh', hold: 5000 });
      this.linkedAt = this.now();
    }
    const name = evt.hook_event_name;
    // these put her somewhere themselves; anything else just brings her out of hiding
    if (name === 'UserPromptSubmit' || name === 'Stop' || name === 'Notification') this.hexa.wake();
    else this.hexa.attend();

    // anything happening after a permission prompt means it was answered
    if (s.waiting && name !== 'Notification') {
      s.waiting = false;
      this.hexa.markWaiting?.(false);
      this.panel.clearKind('alert');
      if (s.pointedAt) {
        s.pointedAt = false;
        this.hexa.stopPointing?.();
      }
      // she may still be on her way to your pointer (mid-teleport): that counts too
      if (this.hexa.mode === 'alert' || this.hexa.alerting) this.hexa.setMode(s.working ? 'work' : 'idle');
    }

    switch (name) {
      case 'SessionStart': return this.onSessionStart(evt, s);
      case 'UserPromptSubmit': return this.onPrompt(evt, s);
      case 'PreToolUse': return this.onTool(evt, s);
      case 'PostToolUseFailure': return this.onToolFailure(evt, s);
      case 'Notification': return this.onNotification(evt, s);
      case 'Stop': return this.onStop(evt, s);
      case 'StopFailure': return this.onStopFailure(evt, s);
      case 'SubagentStart': return this.onSubagent(evt, s, true);
      case 'SubagentStop': return this.onSubagent(evt, s, false);
      case 'PreCompact': return this.say('info', this.line('compact', s), s, { face: 'squint', hold: 4000 });
      case 'SessionEnd': return this.onSessionEnd(evt, s);
      default: return undefined; // PostToolUse, PermissionDenied...: signs of life, already counted
    }
  }

  onSessionStart(evt, s) {
    if (evt.source === 'clear' || evt.source === 'compact') return;
    this.voice.play('hello');
    this.hexa.perform('curious');
    this.say('info', this.line(evt.source === 'resume' ? 'resume' : 'hello', s), s, { face: pick(['smug', 'calm']), hold: 5000 });
  }

  onPrompt(evt, s) {
    Object.assign(s, { taskStart: this.now(), count: 0, files: new Set(), working: true, last: null, error: false });
    // no process-tree match: the window in front when you send a prompt is the one you typed it in
    if (!evt.window_id) s.window = this.windows.fg || s.window || null;
    this.hexa.goToWork();
    const prompt = String(evt.prompt || '').replace(/\s+/g, ' ').trim();
    this.say('work', this.line('prompt', s), s, { quote: prompt ? clip(prompt, 110) : '', face: 'calm', hold: 4500 });
  }

  onTool(evt, s) {
    const action = { ...describeTool(evt, this.t.verbs), state: 'work' };
    // a tool with no prompt before it (she arrived mid-task, or it's an assistant whose hooks don't
    // tell her every prompt, like Antigravity's): the task starts here, not at some older prompt
    if (!s.working) Object.assign(s, { taskStart: this.now(), count: 0, files: new Set(), last: null });
    s.working = true;
    s.error = false;
    s.count += 1;
    s.last = action;
    if (EDIT_TOOLS.has(evt.tool_name)) {
      const file = evt.tool_input?.file_path || evt.tool_input?.notebook_path;
      if (file) s.files.add(file);
    }
    if (this.hexa.mode !== 'alert') this.hexa.setMode('work');
    if (HACKING_TOOLS.has(evt.tool_name)) this.hexa.spark(); // sparks: she's in the system
    this.thinking = null;
    this.panel.setTicker(action);
    if (s.count % WORKING_EVERY === 0) this.say('work', this.line('working', s, { n: s.count }), s, { face: 'smug', hold: 4000 });
  }

  onToolFailure(evt, s) {
    if (evt.is_interrupt) {
      // Esc: Claude Code sends no Stop after an interrupt, so the turn ends here
      s.working = false;
      this.thinking = null;
      this.settle();
      this.say('info', this.line('interrupted', s), s, { face: 'wide', hold: 4000 });
      return;
    }
    s.error = true; // for the HUD, until the next action
    // a missed Read or Edit isn't a crash: the ticker turns red, that's all; a failing command is
    if (evt.tool_name !== 'Bash') {
      this.panel.setTicker({ ...describeTool(evt, this.t.verbs), state: 'error' });
      return;
    }
    const detail = firstErrorLine(evt.error);
    this.hexa.knockback();
    this.voice.play('error');
    this.panel.setTicker({ ...describeTool(evt, this.t.verbs), state: 'error' });
    this.say('error', this.line('error', s), s, { face: pick(['dead', 'angry']), quote: detail, hold: 6000 });
  }

  onNotification(evt, s) {
    const type = evt.notification_type;
    if (ALERTS.has(type) && s.permission) return; // it's already on her card
    if (ALERTS.has(type) && this.quiet) {
      // Do Not Disturb: she lights up, and that's all
      s.waiting = true;
      this.panel.setTicker({ verb: 'WAITING', target: 'for you', state: 'waiting' });
      this.hexa.markWaiting?.(true);
      return;
    }
    if (ALERTS.has(type)) {
      s.waiting = true;
      this.voice.play('alert');
      // you're on another window: she goes and points at Claude's, where the question is
      const win = this.away(s) && this.windows.wins.find((w) => w.id === s.window);
      if (win && this.hexa.canPoint?.(win)) {
        s.pointedAt = true;
        this.say('alert', this.line('alertHere', s), s, { face: 'wide', quote: clip(String(evt.message || ''), 200), hold: null });
        this.panel.setTicker({ verb: 'WAITING', target: 'for you', state: 'waiting' });
        this.hexa.pointAt(win, { label: this.name.toUpperCase() });
        return;
      }
      this.say('alert', this.line('alert', s), s, { face: 'wide', quote: clip(String(evt.message || ''), 200), hold: null });
      this.panel.setTicker({ verb: 'WAITING', target: 'for you', state: 'waiting' });
      this.hexa.comeToPointer();
      return;
    }
    if (type === 'idle_prompt') {
      // Claude is waiting for your next prompt: whatever it was doing is over (an interrupt, a
      // permission prompt you dismissed)
      s.working = false;
      this.thinking = null;
      if (s.waiting) {
        s.waiting = false;
        this.panel.clearKind('alert');
      }
      this.settle();
      this.voice.play('tick');
      return;
    }
    if (evt.message) this.say('info', clip(String(evt.message), 200), s, { face: 'calm', hold: 5000 });
  }

  summary(s) {
    return [
      s.count && `${s.count} ${plural(s.count, ['action', 'actions'])}`,
      s.files.size && `${s.files.size} ${plural(s.files.size, ['file changed', 'files changed'])}`,
      s.taskStart !== null && duration(this.now() - s.taskStart),
    ].filter(Boolean).join(' · ');
  }

  // Is the window you typed your prompt in (Claude's) no longer the one in front?
  // Unknown (no window tracking) counts as no.
  away(s) {
    return Boolean(s.window && this.windows.fg && this.windows.fg !== s.window);
  }

  // The window of the session you talked to last (for her guide), or null.
  claudeWindow() {
    const s = [...this.sessions.values()].filter((v) => v.window).sort((a, b) => b.seen - a.seen)[0];
    return (s && this.windows.wins.find((w) => w.id === s.window)) || null;
  }

  // A PermissionRequest hook is waiting for you (main sends the card; you opted in). She comes to
  // your pointer with it; your click answers through answerPermission (set by app.js). Closing the
  // card without a choice means "ask in Claude".
  onPermissionAsk(card) {
    const s = this.session({ session_id: card.session_id, cwd: card.cwd });
    s.waiting = true;
    s.permission = card.id;
    this.voice.play('alert');
    // the summary from what would really run: never the description Claude wrote for a command
    const { description, ...input } = card.tool_input || {};
    const action = describeTool({ tool_name: card.tool_name, tool_input: input }, this.t.verbs);
    const b = this.t.buttons;
    // Allow only when the whole request reached her (and so is in the box); else Deny or Claude's own dialog
    const actions = [
      ...(card.complete ? [{ id: 'allow', label: b.allow, primary: true }] : []),
      ...(card.complete && card.canAlways ? [{ id: 'always', label: fmt(b.always, { what: clip(card.always, 40) }) }] : []),
      { id: 'deny', label: b.deny },
      { id: 'ask', label: b.ask, ...(card.complete ? {} : { primary: true }) },
    ];
    const detail = [card.detail || '', card.complete && card.canAlways ? `\n${fmt(b.always, { what: card.always })}` : ''].join('');
    let answered = false;
    const answer = (choice) => {
      if (answered) return;
      answered = true;
      s.permission = null;
      s.waiting = false;
      this.restoreTicker(s);
      this.answerPermission?.(card.id, choice);
      if (this.hexa.mode === 'alert' || this.hexa.alerting) this.hexa.setMode(s.working ? 'work' : 'idle');
    };
    this.say('alert', this.line('permission', s), s, {
      face: 'wide', quote: `${action.verb} ${action.target}`.trim(), detail, guarded: true, hold: null, actions, onAction: answer, onDismiss: () => answer('ask'),
    });
    this.panel.setTicker({ verb: 'WAITING', target: 'for you', state: 'waiting' });
    this.hexa.comeToPointer();
  }

  // No answer in time, or the hook hung up (answered in the terminal): the card goes.
  onPermissionGone(id) {
    for (const s of this.sessions.values()) {
      if (s.permission !== id) continue;
      s.permission = null;
      s.waiting = false;
      this.panel.clearKind('alert');
      this.restoreTicker(s);
      if (this.hexa.mode === 'alert' || this.hexa.alerting) this.hexa.setMode(s.working ? 'work' : 'idle');
    }
  }

  // After a wait for you: the ticker shows what Claude was doing again, or goes.
  restoreTicker(s) {
    this.panel.setTicker(s.working && s.last ? s.last : null);
  }

  // A chip in the HUD clicked: she points at that session's window and brings you its last
  // answer. False when there's no such session.
  focusSession(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const win = this.windows.wins.find((w) => w.id === s.window);
    if (win && this.hexa.canPoint?.(win)) {
      this.hexa.pointAt(win, { label: s.title || s.project });
      this.pointingUntil = this.now() + FOCUS_POINT_MS;
    }
    const line = s.reply ? lastSentence(s.reply) : this.line(s.working ? 'working' : 'idle', s, { n: s.count });
    this.say('done', line, s, { face: 'calm', reply: s.reply || '', hold: s.reply ? null : 5000 });
    return true;
  }

  // Back on Claude's window: the answer she was holding up for you can go. And: is the window in
  // front another AI? (jealousy, in tick())
  onWindows(snap) {
    this.windows = snap || { fg: 0, wins: [] };
    const ai = this.windows.fgAi && this.windows.fgAi !== this.assistant ? this.windows.fgAi : null;
    if (ai !== this.jealous?.ai) this.jealous = ai ? { ai, since: this.now() } : null;
    const s = this.replyFor;
    if (s && this.windows.fg === s.window) {
      this.replyFor = null;
      this.panel.clearKind('done');
    }
  }

  async onStop(evt, s) {
    const wasWorking = s.working;
    s.working = false;
    // for the HUD: when it finished, how long it took, and the answer, to bring you later
    s.doneAt = this.now();
    s.lastDuration = s.taskStart === null ? 0 : s.doneAt - s.taskStart;
    s.reply = String(evt.last_assistant_message || '');
    this.thinking = null;
    const summary = this.summary(s);
    const quote = lastSentence(evt.last_assistant_message);
    // not on Claude's window any more: you can't see the answer, so she brings it to you, whole,
    // and holds it up until you're back on Claude's window or click it away
    const reply = this.away(s) ? String(evt.last_assistant_message || '') : '';
    const extra = reply ? { reply, hold: null } : {};
    if (reply) this.replyFor = s;
    this.settle();
    const elapsed = s.taskStart === null ? 0 : this.now() - s.taskStart;
    const bigJob = s.count >= BIG_JOB_ACTIONS || elapsed > BIG_JOB_MS;
    if (!wasWorking || !bigJob) {
      // a quick back-and-forth doesn't deserve the whole show
      this.voice.play('done');
      this.hexa.perform('hop');
      this.say('done', this.line('doneQuiet', s), s, { face: 'calm', summary, quote, hold: 7000, ...extra });
      return;
    }
    // the panel comes in once she's back down from her victory pose
    await this.hexa.celebrate(summary);
    this.say('done', this.line('done', s), s, { face: 'laugh', summary, quote, hold: 14000, ...extra });
    if (s.count >= FORK_JOB_ACTIONS || elapsed > FORK_JOB_MS) this.hexa.fork?.();
  }

  onStopFailure(evt, s) {
    s.working = false;
    this.settle();
    this.hexa.knockback();
    this.voice.play('error');
    this.say('error', this.line('stopFailure', s), s, { face: 'dead', quote: clip(String(evt.error || evt.message || ''), 120), hold: 9000 });
  }

  onSubagent(evt, s, starting) {
    const action = { verb: starting ? 'SPAWNS' : 'REAPS', target: evt.agent_type || 'a helper', state: 'work' };
    s.last = action;
    this.panel.setTicker(action);
    if (starting) this.hexa.perform('hop');
  }

  onSessionEnd(evt, s) {
    this.sessions.delete(s.id);
    this.settle();
    this.say('info', this.line('sessionEnd', s), s, { face: 'calm', hold: 4000 });
  }

  // Once a second (app.js). Mid-task and nothing from Claude for a while: it's thinking (a big
  // question, a slow local model). The ticker counts so you can tell nothing froze.
  tick() {
    const now = this.now();
    // another AI in front for a while: she notices (once in a while, never quietly)
    if (this.jealous && !this.quiet && this.jealousOn !== false && now - this.jealous.since > JEALOUS_AFTER_MS
      && (this.lastJealous === undefined || now - this.lastJealous > JEALOUS_EVERY_MS)) {
      this.lastJealous = now;
      this.onJealous?.(this.jealous.ai);
    }
    if (this.pointingUntil && now >= this.pointingUntil) {
      this.pointingUntil = 0;
      this.hexa.stopPointing?.();
    }
    if (this.lastTick !== null && now - this.lastTick > TICK_GAP_MS) this.resume(); // slept: not Claude being quiet
    this.lastTick = now;
    for (const s of this.busySessions) {
      if (now - s.seen > STALE_MS) s.working = false;
    }
    const busy = this.busySessions;
    if (!busy.length) {
      if (this.thinking) this.settle();
      this.thinking = null;
      return;
    }
    const s = busy.sort((a, b) => b.seen - a.seen)[0];
    const quiet = now - s.seen;
    if (s.waiting || quiet < THINK_AFTER) {
      if (this.thinking && s.last) this.panel.setTicker(s.last);
      this.thinking = null;
      return;
    }
    if (this.thinking?.s !== s || this.thinking.since !== s.seen) this.thinking = { s, since: s.seen, said: 0 };
    const th = this.thinking;
    this.panel.setTicker({ verb: 'THINKING…', target: '', state: 'thinking', seconds: Math.floor(quiet / 1000) });
    if (th.said < 1 && quiet >= THINK_SAY) {
      th.said = 1;
      this.hexa.perform(pick(['look', 'spin']));
      this.say('work', this.line('thinkSay', s), s, { face: 'loading', hold: 4000 });
    }
    if (th.said < 2 && quiet >= THINK_LONG) {
      th.said = 2;
      this.say('info', this.line('thinkLong', s), s, { face: 'calm', hold: 8000 });
    }
  }

  // After the machine wakes from sleep: the time it slept isn't Claude being quiet.
  resume() {
    const now = this.now();
    if (this.thinking) this.panel.setTicker(this.thinking.s.last || null); // the thinking ticker goes
    for (const s of this.sessions.values()) s.seen = now;
    this.thinking = null;
  }

  // What she says when you click her.
  status() {
    const busy = this.busySessions;
    if (!busy.length) return this.line('pokeIdle', null);
    const s = busy.sort((a, b) => b.seen - a.seen)[0];
    const time = s.taskStart === null ? '…' : duration(this.now() - s.taskStart);
    return `${this.line('poke', s)} ${s.project}: ${s.count} ${plural(s.count, ['action', 'actions'])}, ${time}.`;
  }
}
