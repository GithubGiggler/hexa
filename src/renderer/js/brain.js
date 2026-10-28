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
// a job this small doesn't get the whole victory, just a word
const BIG_JOB_ACTIONS = 3;
const BIG_JOB_MS = 20000;

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
  }

  get t() {
    return linesFor(this.lang);
  }

  get name() {
    return { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' }[this.assistant] || 'Claude';
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
    if (evt.session_title) s.title = evt.session_title;
    s.seen = this.now();
    return s;
  }

  get busySessions() {
    return [...this.sessions.values()].filter((s) => s.working);
  }

  say(kind, line, s, extra = {}) {
    return this.panel.say({ kind, line, tag: s ? s.title || s.project : '', ...extra });
  }

  settle() {
    if (this.busySessions.length) return;
    this.panel.setTicker(null);
    this.hexa.setMode('idle');
  }

  handle(evt) {
    // Codex's and Antigravity's hooks mark their sessions (codex:..., agy:...): only the one she watches counts
    const owner = /^(codex|agy):/.exec(String(evt.session_id || ''))?.[1] || 'claude';
    if (!evt.demo && owner !== this.assistant) return undefined;
    if (!this.watching && !evt.demo) return undefined;
    const s = this.session(evt);
    // the first real event that ever reaches her (the demo's don't count)
    if (!this.linked && !evt.demo) {
      this.linked = true;
      this.onLinked?.();
      this.say('info', this.line('linked', s), s, { face: 'laugh', hold: 5000 });
    }
    const name = evt.hook_event_name;
    // these put her somewhere themselves; anything else just brings her out of hiding
    if (name === 'UserPromptSubmit' || name === 'Stop' || name === 'Notification') this.hexa.wake();
    else this.hexa.attend();

    // anything happening after a permission prompt means it was answered
    if (s.waiting && name !== 'Notification') {
      s.waiting = false;
      this.panel.clearKind('alert');
      if (this.hexa.mode === 'alert') this.hexa.setMode(s.working ? 'work' : 'idle');
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
    Object.assign(s, { taskStart: this.now(), count: 0, files: new Set(), working: true, last: null });
    this.hexa.goToWork();
    const prompt = String(evt.prompt || '').replace(/\s+/g, ' ').trim();
    this.say('work', this.line('prompt', s), s, { quote: prompt ? clip(prompt, 110) : '', face: 'calm', hold: 4500 });
  }

  onTool(evt, s) {
    const action = { ...describeTool(evt, this.t.verbs), state: 'work' };
    s.working = true;
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
      this.say('info', this.line('interrupted', s), s, { face: 'wide', hold: 4000 });
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
    if (ALERTS.has(type)) {
      s.waiting = true;
      this.voice.play('alert');
      this.say('alert', this.line('alert', s), s, { face: 'wide', quote: clip(String(evt.message || ''), 200), hold: null });
      this.panel.setTicker({ verb: 'WAITING', target: 'for you', state: 'waiting' });
      this.hexa.comeToPointer();
      return;
    }
    if (type === 'idle_prompt') {
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

  async onStop(evt, s) {
    const wasWorking = s.working;
    s.working = false;
    this.thinking = null;
    const summary = this.summary(s);
    const quote = lastSentence(evt.last_assistant_message);
    this.settle();
    const elapsed = s.taskStart === null ? 0 : this.now() - s.taskStart;
    const bigJob = s.count >= BIG_JOB_ACTIONS || elapsed > BIG_JOB_MS;
    if (!wasWorking || !bigJob) {
      // a quick back-and-forth doesn't deserve the whole show
      this.voice.play('done');
      this.hexa.perform('hop');
      this.say('done', this.line('doneQuiet', s), s, { face: 'calm', summary, quote, hold: 7000 });
      return;
    }
    // the panel comes in once she's back down from her victory pose
    await this.hexa.celebrate(summary);
    this.say('done', this.line('done', s), s, { face: 'laugh', summary, quote, hold: 14000 });
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
    const busy = this.busySessions;
    if (!busy.length) {
      this.thinking = null;
      return;
    }
    const s = busy.sort((a, b) => b.seen - a.seen)[0];
    const quiet = this.now() - s.seen;
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
