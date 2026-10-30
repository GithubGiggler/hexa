'use strict';

// Her records of your work with Claude: one small file per day (your local date) in
// ~/.local/share/hexa/history/YYYY-MM-DD.json, built from the hook events and the token counts in
// Claude Code's transcripts. Writes are debounced and atomic (a temp file renamed into place).
// From transcripts only numbers are kept; changed files only as short hashes, enough to count
// each once without keeping its path.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const transcript = require('./transcript');
const { loadPrices, costOfModels } = require('./prices');

const VERSION = 1;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// when Claude has just written to its transcript
const TOKEN_EVENTS = new Set(['Stop', 'StopFailure', 'SubagentStop', 'SessionEnd']);
// a failure that only says you said no to the permission prompt
const DECLINED = /user (doesn't|does not) want|rejected|denied/i;
const MAX_FILES = 5000;                          // file hashes kept per day
const MAX_SPAN = 400;                            // days one summary may cover
const SESSION_IDLE_MS = 12 * 3600 * 1000;        // a session this quiet is let go
const OFFSET_KEEP_MS = 30 * 24 * 3600 * 1000;    // and its transcript's offset after a month

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
const num = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

function parseDate(key) {
  const m = DATE.exec(String(key));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dateKey(d) === key ? d : null; // 2026-02-30 is not a day
}

function addDays(key, n) {
  const d = parseDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Every date from `from` to `to`, both included, oldest first; at most MAX_SPAN of the latest.
function eachDate(from, to) {
  if (!parseDate(from) || !parseDate(to)) return [];
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out = [];
  for (let k = b; k >= a && out.length < MAX_SPAN; k = addDays(k, -1)) out.push(k);
  return out.reverse();
}

// today, week (the last 7 days) or month (the last 30), ending today
function rangeFor(name, t = Date.now()) {
  const today = dateKey(t);
  if (name === 'today' || name === 'day') return { from: today, to: today };
  if (name === 'week') return { from: addDays(today, -6), to: today };
  if (name === 'month') return { from: addDays(today, -29), to: today };
  return null;
}

const projectOf = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop()?.slice(0, 80) || 'unknown';
const fileKey = (file) => crypto.createHash('sha256').update(String(file)).digest('hex').slice(0, 16);

function emptyDay(date) {
  return {
    version: VERSION,
    date,
    tasks: 0,
    prompts: 0,
    actions: 0,
    errors: 0,
    filesChanged: 0,
    files: [],
    approvals: { total: 0, viaHexa: 0 },
    timeByProject: {},
    tokens: {},
    cost: { usd: 0, unpriced: [], estimate: true },
    longestMission: null,
  };
}

// A day read from disk, with anything missing or odd put right.
function normalizeDay(raw, date) {
  const d = emptyDay(date);
  if (!raw || typeof raw !== 'object') throw new Error('not a day record');
  for (const k of ['tasks', 'prompts', 'actions', 'errors']) d[k] = num(raw[k]);
  if (Array.isArray(raw.files)) d.files = raw.files.filter((f) => typeof f === 'string').slice(0, MAX_FILES);
  d.filesChanged = d.files.length;
  d.approvals = { total: num(raw.approvals?.total), viaHexa: num(raw.approvals?.viaHexa) };
  for (const [p, ms] of Object.entries(raw.timeByProject || {})) if (num(ms)) d.timeByProject[p] = num(ms);
  transcript.addModels(d.tokens, raw.tokens);
  const lm = raw.longestMission;
  if (lm && num(lm.ms)) d.longestMission = { ms: num(lm.ms), project: String(lm.project || 'unknown') };
  return d;
}

function createHistory({
  dir,
  prices = null,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  debounceMs = 2000,
  readTranscript = transcript.readNew,
  log = console,
} = {}) {
  let table = prices || loadPrices({ log });
  const days = new Map();      // date -> record: today, and any day with changes not yet written
  const dirty = new Set();
  const sessions = new Map();  // session id -> what's going on in it
  const seen = new Map();      // message ids already counted, across all transcripts
  const queues = new Map();    // transcript -> its read in progress, so reads never overlap
  const offsetsFile = path.join(dir, 'offsets.json');
  const offsets = loadOffsets(); // transcript -> { offset, ino, at }: survives restarts, so nothing counts twice
  let offsetsDirty = false;
  let timer = null;

  const dayFile = (date) => path.join(dir, `${date}.json`);
  const failing = new Set(); // files whose last write failed: said once, not every two seconds

  function writeAtomic(file, data) {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(temp, file);
      failing.delete(file);
      return true;
    } catch (err) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // force only forgives a missing file: the folder may not even be one
      }
      if (!failing.has(file)) log.error(`[hexa] could not save ${file}: ${err.message}`);
      failing.add(file);
      return false;
    }
  }

  function loadDay(date) {
    const file = dayFile(date);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return emptyDay(date);
    }
    try {
      return normalizeDay(JSON.parse(text), date);
    } catch (err) {
      const aside = `${file}.corrupt-${now()}`;
      try {
        fs.renameSync(file, aside);
      } catch {
        // can't move it: it just won't be read
      }
      log.error(`[hexa] ${file} could not be read (${err.message}); kept it as ${aside} and started the day over`);
      return emptyDay(date);
    }
  }

  function loadOffsets() {
    const out = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(offsetsFile, 'utf8'));
      for (const [file, s] of Object.entries(raw?.transcripts || {})) {
        if (Number.isFinite(s?.offset)) out.set(file, { offset: s.offset, ino: Number.isFinite(s.ino) ? s.ino : null, at: num(s.at) });
      }
    } catch {
      // none yet, or unreadable: transcripts first met today count from today
    }
    return out;
  }

  function saveOffsets() {
    const cutoff = now() - OFFSET_KEEP_MS;
    for (const [file, s] of offsets) if (s.at < cutoff) offsets.delete(file);
    if (writeAtomic(offsetsFile, { version: VERSION, transcripts: Object.fromEntries(offsets) })) offsetsDirty = false;
  }

  // the record to change: loaded once, then kept until written
  function day(date) {
    let d = days.get(date);
    if (!d) {
      d = loadDay(date);
      days.set(date, d);
    }
    return d;
  }
  const today = () => day(dateKey(now()));

  // Writes at most once per debounceMs, and never later than that after a change.
  function schedule() {
    if (timer) return;
    timer = timers.setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    timer?.unref?.();
  }

  function touch(d) {
    dirty.add(d.date);
    schedule();
  }

  // Never throws: it runs from a timer and at quit, where a throw would be the app's problem.
  function flush() {
    if (timer) {
      timers.clearTimeout(timer);
      timer = null;
    }
    try {
      writeDirty();
    } catch (err) {
      log.error(`[hexa] history: ${err.message}`);
    }
  }

  function writeDirty() {
    for (const date of [...dirty]) {
      const d = days.get(date);
      d.filesChanged = d.files.length;
      const cost = costOfModels(table, d.tokens);
      d.cost = { usd: Math.round(cost.usd * 1e6) / 1e6, unpriced: cost.unpriced, estimate: true };
      if (writeAtomic(dayFile(date), d)) dirty.delete(date);
    }
    if (offsetsDirty) saveOffsets();
    const current = dateKey(now());
    for (const date of [...days.keys()]) if (date !== current && !dirty.has(date)) days.delete(date);
  }

  function sessionFor(evt, t) {
    const key = typeof evt.session_id === 'string' && evt.session_id ? evt.session_id : '-';
    let s = sessions.get(key);
    if (!s) {
      forgetQuiet(t);
      s = { key, project: 'unknown', task: null, pending: null, lastTool: null, lastAt: t };
      sessions.set(key, s);
    }
    if (evt.cwd) s.project = projectOf(evt.cwd);
    return s;
  }

  // sessions that went quiet long ago (Claude closed without a SessionEnd): their open turn ends
  // where they went quiet
  function forgetQuiet(t) {
    for (const [key, s] of sessions) {
      if (t - s.lastAt < SESSION_IDLE_MS) continue;
      endTask(s, s.lastAt, false);
      sessions.delete(key);
    }
  }

  // A turn's time goes to its project; a turn that ended with a Stop is a task.
  function endTask(s, end, completed) {
    const task = s.task;
    if (!task) return;
    s.task = null;
    const ms = Math.max(0, end - task.start);
    const d = today();
    if (ms > 0) d.timeByProject[task.project] = (d.timeByProject[task.project] || 0) + ms;
    if (completed) {
      d.tasks += 1;
      if (!d.longestMission || ms > d.longestMission.ms) d.longestMission = { ms, project: task.project };
    }
    touch(d);
  }

  // Claude asked to use a tool; it running afterwards means you said yes.
  function asked(s, tool) {
    s.pending = { id: tool?.id || null, name: tool?.name || null };
  }

  function ran(s, evt, d) {
    const p = s.pending;
    if (!p) return;
    const match = p.id && evt.tool_use_id ? p.id === evt.tool_use_id : !p.name || p.name === evt.tool_name;
    if (!match) return;
    s.pending = null;
    d.approvals.total += 1; // viaHexa counts the ones answered on her card (§7.1), when that exists
  }

  function addFile(d, input) {
    const file = input?.file_path || input?.notebook_path;
    if (typeof file !== 'string' || !file) return;
    const key = fileKey(file);
    if (!d.files.includes(key) && d.files.length < MAX_FILES) d.files.push(key);
  }

  function readTokens(list) {
    const files = [...new Set(list.filter((f) => typeof f === 'string' && path.isAbsolute(f) && f.endsWith('.jsonl') && !f.includes('\0')))];
    return Promise.all(files.map(readOne)).then(() => undefined);
  }

  function readOne(file) {
    const run = async () => {
      const known = offsets.get(file);
      // a transcript never read before: only today's lines count, earlier ones aren't today's
      const since = known ? null : startOfDay(now());
      const r = await readTranscript(file, { state: known || null, seen, since });
      if (r.missing) return;
      offsets.set(file, { offset: r.state.offset, ino: r.state.ino, at: now() });
      offsetsDirty = true;
      const d = today();
      transcript.addModels(d.tokens, r.models);
      touch(d);
    };
    const next = (queues.get(file) || Promise.resolve()).then(run).catch((err) => {
      log.error(`[hexa] could not read token usage from a transcript: ${err.message}`);
    });
    queues.set(file, next);
    next.then(() => {
      if (queues.get(file) === next) queues.delete(file);
    });
    return next;
  }

  function handle(evt) {
    const name = evt?.hook_event_name;
    if (typeof name !== 'string') return null;
    const t = now();
    const s = sessionFor(evt, t);
    const d = today();
    switch (name) {
      case 'UserPromptSubmit':
        endTask(s, s.lastAt, false); // the last turn ended without a Stop: it ended where it went quiet
        d.prompts += 1;
        s.task = { start: t, project: s.project };
        s.pending = null;
        break;
      case 'PreToolUse':
        d.actions += 1;
        s.lastTool = { id: evt.tool_use_id || null, name: evt.tool_name || null };
        if (EDIT_TOOLS.has(evt.tool_name)) addFile(d, evt.tool_input);
        break;
      case 'PermissionRequest':
        asked(s, { id: evt.tool_use_id, name: evt.tool_name });
        break;
      case 'Notification':
        // the prompt follows the PreToolUse of the tool it asks about
        if (evt.notification_type === 'permission_prompt') asked(s, s.lastTool);
        else if (evt.notification_type === 'idle_prompt') endTask(s, s.lastAt, false);
        break;
      case 'PostToolUse':
        ran(s, evt, d);
        if (evt.tool_name === 'Bash' && evt.error) d.errors += 1;
        break;
      case 'PostToolUseFailure':
        if (evt.is_interrupt) {
          s.pending = null;
          endTask(s, t, false); // Esc: no Stop follows
        } else if (s.pending && DECLINED.test(String(evt.error || ''))) {
          s.pending = null;     // you said no: not an error
        } else {
          ran(s, evt, d);
          d.errors += 1;
        }
        break;
      case 'PermissionDenied':
        s.pending = null;
        break;
      case 'Stop':
        s.pending = null;
        endTask(s, t, true);
        break;
      case 'StopFailure':
        s.pending = null;
        d.errors += 1;
        endTask(s, t, false);
        break;
      case 'SessionEnd':
        endTask(s, t, false);
        break;
      default:
        break;
    }
    s.lastAt = t;
    if (name === 'SessionEnd') sessions.delete(s.key);
    touch(d);
    return TOKEN_EVENTS.has(name) ? readTokens([evt.transcript_path, evt.agent_transcript_path]) : null;
  }

  // Never throws: a bad event must not keep the rest of the app from seeing it. Resolves once any
  // transcript reading it started is done.
  function record(evt) {
    try {
      return handle(evt) || Promise.resolve();
    } catch (err) {
      log.error(`[hexa] history: ${err.message}`);
      return Promise.resolve();
    }
  }

  // You allowed a tool on her permission card: one approval, and one through Hexa.
  function approvedViaHexa() {
    try {
      const d = today();
      d.approvals.total += 1;
      d.approvals.viaHexa += 1;
      touch(d);
    } catch (err) {
      log.error(`[hexa] history: ${err.message}`);
    }
  }

  const peek = (date) => days.get(date) || loadDay(date);

  // A day as the stats window and the CLI see it: counts, no file hashes.
  function view(d) {
    const activeMs = Object.values(d.timeByProject).reduce((a, b) => a + b, 0);
    const tokens = transcript.addModels({}, d.tokens);
    return {
      date: d.date,
      tasks: d.tasks,
      prompts: d.prompts,
      actions: d.actions,
      errors: d.errors,
      filesChanged: d.files.length,
      approvals: { ...d.approvals },
      timeByProject: { ...d.timeByProject },
      activeMs,
      tokens,
      totalTokens: Object.values(tokens).reduce((a, u) => a + transcript.totalOf(u), 0),
      cost: costOfModels(table, tokens),
      longestMission: d.longestMission && { ...d.longestMission },
    };
  }

  const span = (range = {}) => {
    const t = dateKey(now());
    return eachDate(range.from || t, range.to || t);
  };

  // One entry per day from `from` to `to` (YYYY-MM-DD, both included), empty days too.
  function daysIn(range) {
    return span(range).map((date) => view(peek(date)));
  }

  // The days from `from` to `to` added up. A file changed on several days counts once.
  function summary(range) {
    const list = span(range).map(peek);
    const out = {
      from: list[0]?.date ?? null,
      to: list.at(-1)?.date ?? null,
      days: list.length,
      tasks: 0,
      prompts: 0,
      actions: 0,
      errors: 0,
      filesChanged: 0,
      approvals: { total: 0, viaHexa: 0 },
      timeByProject: {},
      activeMs: 0,
      tokens: {},
      totalTokens: 0,
      cost: null,
      longestMission: null,
      prices: { updated: table.updated, custom: table.custom },
    };
    const files = new Set();
    for (const d of list) {
      for (const k of ['tasks', 'prompts', 'actions', 'errors']) out[k] += d[k];
      out.approvals.total += d.approvals.total;
      out.approvals.viaHexa += d.approvals.viaHexa;
      for (const f of d.files) files.add(f);
      for (const [p, ms] of Object.entries(d.timeByProject)) {
        out.timeByProject[p] = (out.timeByProject[p] || 0) + ms;
        out.activeMs += ms;
      }
      transcript.addModels(out.tokens, d.tokens);
      if (d.longestMission && (!out.longestMission || d.longestMission.ms > out.longestMission.ms)) {
        out.longestMission = { ...d.longestMission, date: d.date };
      }
    }
    out.filesChanged = files.size;
    out.totalTokens = Object.values(out.tokens).reduce((a, u) => a + transcript.totalOf(u), 0);
    out.cost = costOfModels(table, out.tokens);
    return out;
  }

  // your ~/.config/hexa/prices.json may have changed
  function reloadPrices() {
    table = loadPrices({ log });
    return table;
  }

  return { record, approvedViaHexa, summary, days: daysIn, flush, reloadPrices, dir };
}

module.exports = { createHistory, rangeFor, dateKey, eachDate, emptyDay, VERSION };
