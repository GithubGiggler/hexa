'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory, rangeFor, dateKey, eachDate } = require('../src/main/usage/history');
const { loadPrices } = require('../src/main/usage/prices');

const prices = loadPrices({ file: '/nonexistent/prices.json' });
const quiet = { warn: () => {}, error: () => {} };
const MIN = 60 * 1000;

// A clock and timers the test moves by hand.
function fakeClock(start) {
  let t = start;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) {
        seq += 1;
        pending.set(seq, { fn, at: t + ms });
        return seq;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    advance(ms) {
      t += ms;
      for (const [id, p] of [...pending]) {
        if (p.at <= t) {
          pending.delete(id);
          p.fn();
        }
      }
    },
    pending: () => pending.size,
  };
}

const at = (h, m = 0, day = 29) => new Date(2026, 9, day, h, m, 0).getTime();

function setup(start = at(9)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-history-'));
  const dir = path.join(root, 'history');
  const clock = fakeClock(start);
  const make = () => createHistory({ dir, prices, now: clock.now, timers: clock.timers, debounceMs: 2000, log: quiet });
  return { root, dir, clock, make, h: make() };
}

const readDay = (dir, date) => JSON.parse(fs.readFileSync(path.join(dir, `${date}.json`), 'utf8'));
const ev = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', cwd: '/home/u/code/capri', ...extra });

function assistantLine(id, model, usage, timestamp = new Date(at(9)).toISOString()) {
  return JSON.stringify({ type: 'assistant', timestamp, message: { id, model, content: [{ type: 'text', text: 'secret words' }], usage } }) + '\n';
}

test('a task: prompt, actions, files changed, its time by project, the longest mission', () => {
  const { h, clock, dir } = setup();
  h.record(ev('SessionStart'));
  h.record(ev('UserPromptSubmit', { prompt: 'fix it' }));
  clock.advance(1 * MIN);
  h.record(ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/home/u/code/capri/a.js' } }));
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/home/u/code/capri/a.js', old_string_len: 3 } }));
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/home/u/code/capri/a.js' } }));
  h.record(ev('PreToolUse', { tool_name: 'Write', tool_input: { file_path: '/home/u/code/capri/b.js' } }));
  h.record(ev('PreToolUse', { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/home/u/code/capri/n.ipynb' } }));
  h.record(ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  clock.advance(4 * MIN);
  h.record(ev('Stop'));
  clock.advance(2000);
  const d = readDay(dir, '2026-10-29');
  assert.equal(d.date, '2026-10-29');
  assert.equal(d.tasks, 1);
  assert.equal(d.prompts, 1);
  assert.equal(d.actions, 6);
  assert.equal(d.filesChanged, 3, 'Read is not a change; a.js edited twice counts once');
  assert.deepEqual(d.timeByProject, { capri: 5 * MIN });
  assert.deepEqual(d.longestMission, { ms: 5 * MIN, project: 'capri' });
  assert.ok(!JSON.stringify(d).includes('a.js'), 'changed files are kept as hashes, not paths');
  assert.ok(!JSON.stringify(d).includes('fix it'), 'prompts are counted, not kept');
});

test('writes are debounced: one write for a burst, within the debounce time', () => {
  const { h, clock, dir } = setup();
  h.record(ev('UserPromptSubmit'));
  assert.equal(fs.existsSync(path.join(dir, '2026-10-29.json')), false);
  for (let i = 0; i < 20; i++) {
    clock.advance(50);
    h.record(ev('PreToolUse', { tool_name: 'Read' }));
  }
  assert.equal(clock.pending(), 1, 'a single write is scheduled for the whole burst');
  clock.advance(1000);
  assert.equal(readDay(dir, '2026-10-29').actions, 20);
  assert.equal(clock.pending(), 0);
  h.record(ev('PreToolUse', { tool_name: 'Read' }));
  h.flush(); // on quit: written at once
  assert.equal(readDay(dir, '2026-10-29').actions, 21);
  assert.equal(clock.pending(), 0);
});

test('writes are atomic: no temp file is left behind', () => {
  const { h, dir } = setup();
  h.record(ev('UserPromptSubmit'));
  h.flush();
  assert.deepEqual(fs.readdirSync(dir), ['2026-10-29.json']);
});

test('errors: tool failures and failed turns; an interrupt is not an error and ends the turn', () => {
  const { h, clock } = setup();
  h.record(ev('UserPromptSubmit'));
  h.record(ev('PreToolUse', { tool_name: 'Bash' }));
  h.record(ev('PostToolUseFailure', { tool_name: 'Bash', error: 'Exit code 1' }));
  h.record(ev('PreToolUse', { tool_name: 'Read' }));
  h.record(ev('PostToolUseFailure', { tool_name: 'Read', error: 'File does not exist.' }));
  clock.advance(MIN);
  h.record(ev('PostToolUseFailure', { tool_name: 'Bash', is_interrupt: true }));
  h.record(ev('UserPromptSubmit'));
  h.record(ev('StopFailure', { error: 'rate_limit' }));
  const s = h.summary();
  assert.equal(s.errors, 3);
  assert.equal(s.tasks, 0, 'turns that end without a Stop are not tasks');
  assert.equal(s.activeMs, MIN, 'but their time counts');
});

test('a turn that ends without a Stop ends where it went quiet', () => {
  const { h, clock } = setup();
  h.record(ev('UserPromptSubmit'));
  clock.advance(2 * MIN);
  h.record(ev('PreToolUse', { tool_name: 'Read' }));
  clock.advance(60 * MIN); // nothing more from that turn
  h.record(ev('UserPromptSubmit'));
  clock.advance(MIN);
  h.record(ev('Stop'));
  const s = h.summary();
  assert.equal(s.activeMs, 3 * MIN);
  assert.equal(s.tasks, 1);
  assert.equal(s.longestMission.ms, MIN);
});

test('time goes to each session\'s own project', () => {
  const { h, clock } = setup();
  h.record(ev('UserPromptSubmit', { session_id: 'a', cwd: '/w/api' }));
  h.record(ev('UserPromptSubmit', { session_id: 'b', cwd: '/w/web/' }));
  clock.advance(2 * MIN);
  h.record(ev('Stop', { session_id: 'a', cwd: '/w/api' }));
  clock.advance(MIN);
  h.record(ev('Stop', { session_id: 'b', cwd: '/w/web/' }));
  const s = h.summary();
  assert.deepEqual(s.timeByProject, { api: 2 * MIN, web: 3 * MIN });
  assert.deepEqual(s.longestMission, { ms: 3 * MIN, project: 'web', date: '2026-10-29' });
});

test('approvals: a tool asked about that then runs; none through Hexa yet', () => {
  const { h } = setup();
  h.record(ev('UserPromptSubmit'));
  h.record(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' }));
  h.record(ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }));
  h.record(ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' }));
  h.record(ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' })); // counted once
  // asked, then declined
  h.record(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 't2' }));
  h.record(ev('Notification', { notification_type: 'permission_prompt' }));
  h.record(ev('PermissionDenied', { tool_name: 'Bash' }));
  h.record(ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 't3' }));
  // declined in the dialog: the tool "fails", but that's you saying no
  h.record(ev('PreToolUse', { tool_name: 'Write', tool_use_id: 't4' }));
  h.record(ev('Notification', { notification_type: 'permission_prompt' }));
  h.record(ev('PostToolUseFailure', { tool_name: 'Write', tool_use_id: 't4', error: "The user doesn't want to proceed with this tool use." }));
  // a parallel tool finishing while the prompt is up is not the approval
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_use_id: 't5' }));
  h.record(ev('Notification', { notification_type: 'permission_prompt' }));
  h.record(ev('PostToolUse', { tool_name: 'Read', tool_use_id: 't6' }));
  h.record(ev('PostToolUse', { tool_name: 'Edit', tool_use_id: 't5' }));
  // the opt-in permission hook names the tool itself
  h.record(ev('PermissionRequest', { tool_name: 'WebFetch' }));
  h.record(ev('PostToolUse', { tool_name: 'WebFetch' }));
  const s = h.summary();
  assert.deepEqual(s.approvals, { total: 3, viaHexa: 0 });
  assert.equal(s.errors, 0);
});

test('tokens: read from the transcript on Stop, only new lines each time, with an estimated cost', async () => {
  const { h, root } = setup();
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, assistantLine('m1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000 }));
  await h.record(ev('Stop', { transcript_path: file }));
  fs.appendFileSync(file, assistantLine('m1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000 })
    + assistantLine('m2', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 20 }));
  await h.record(ev('SubagentStop', { transcript_path: file }));
  await h.record(ev('SessionEnd', { transcript_path: file }));
  const s = h.summary();
  assert.deepEqual(s.tokens['claude-opus-5-5'], { input: 1000, output: 500, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 10000, messages: 1 });
  assert.equal(s.tokens['claude-sonnet-5-5'].output, 20);
  assert.equal(s.totalTokens, 11530);
  assert.equal(s.cost.estimate, true);
  const expected = (1000 * 4 + 500 * 20 + 10000 * 0.2 + 10 * 2 + 20 * 10) / 1e6;
  assert.ok(Math.abs(s.cost.usd - expected) < 1e-12);
  h.flush();
  const d = readDay(path.join(root, 'history'), '2026-10-29');
  assert.ok(!JSON.stringify(d).includes('secret'));
  assert.ok(Math.abs(d.cost.usd - expected) < 1e-6);
});

test('subagent transcripts are read too, and a message in both counts once', async () => {
  const { h, root } = setup();
  const main = path.join(root, 'main.jsonl');
  const agent = path.join(root, 'agent-1.jsonl');
  fs.writeFileSync(main, assistantLine('m1', 'claude-opus-5-5', { output_tokens: 5 }));
  fs.writeFileSync(agent, assistantLine('m1', 'claude-opus-5-5', { output_tokens: 5 }) + assistantLine('a1', 'claude-haiku-5-5', { output_tokens: 7 }));
  await h.record(ev('SubagentStop', { transcript_path: main, agent_transcript_path: agent }));
  const s = h.summary();
  assert.equal(s.tokens['claude-opus-5-5'].output, 5);
  assert.equal(s.tokens['claude-haiku-5-5'].output, 7);
});

test('two Stops at once read the transcript one after the other, never twice', async () => {
  const { h, root } = setup();
  const file = path.join(root, 's.jsonl');
  fs.writeFileSync(file, assistantLine('m1', 'claude-opus-5-5', { output_tokens: 5 }) + assistantLine('m2', 'claude-opus-5-5', { output_tokens: 5 }));
  await Promise.all([h.record(ev('Stop', { transcript_path: file })), h.record(ev('Stop', { transcript_path: file }))]);
  assert.equal(h.summary().tokens['claude-opus-5-5'].output, 10);
});

test('after a restart nothing counts twice, and the day goes on from what was saved', async () => {
  const { make, root, clock } = setup();
  const file = path.join(root, 's.jsonl');
  fs.writeFileSync(file, assistantLine('m1', 'claude-opus-5-5', { output_tokens: 5 }));
  const first = make();
  first.record(ev('UserPromptSubmit'));
  await first.record(ev('Stop', { transcript_path: file }));
  first.flush();

  clock.advance(MIN);
  const second = make();
  fs.appendFileSync(file, assistantLine('m2', 'claude-opus-5-5', { output_tokens: 3 }));
  second.record(ev('UserPromptSubmit'));
  await second.record(ev('Stop', { transcript_path: file }));
  const s = second.summary();
  assert.equal(s.tokens['claude-opus-5-5'].output, 8);
  assert.equal(s.prompts, 2);
  assert.equal(s.tasks, 2);
});

test('a transcript first met today counts only today\'s lines', async () => {
  const { h, root } = setup(at(9));
  const file = path.join(root, 'old.jsonl');
  fs.writeFileSync(file,
    assistantLine('y1', 'claude-opus-5-5', { output_tokens: 1000 }, new Date(at(22, 0, 28)).toISOString())
    + assistantLine('t1', 'claude-opus-5-5', { output_tokens: 4 }, new Date(at(8, 30)).toISOString()));
  await h.record(ev('Stop', { transcript_path: file }));
  assert.equal(h.summary().tokens['claude-opus-5-5'].output, 4);
});

test('only absolute .jsonl paths are read', async () => {
  const { h, root } = setup();
  const reads = [];
  const spy = createHistory({ dir: path.join(root, 'h2'), prices, log: quiet, readTranscript: async (f) => { reads.push(f); return { missing: true }; } });
  await spy.record(ev('Stop', { transcript_path: 'relative.jsonl' }));
  await spy.record(ev('Stop', { transcript_path: '/etc/passwd' }));
  await spy.record(ev('Stop', { transcript_path: '/a/b.jsonl', agent_transcript_path: '/a/b.jsonl' }));
  assert.deepEqual(reads, ['/a/b.jsonl']);
  spy.flush();
  assert.ok(h);
});

test('days fall on your local date; summaries add them up and list empty days too', () => {
  const { h, clock, dir } = setup(at(23, 50, 28));
  h.record(ev('UserPromptSubmit'));
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/a.js' } }));
  clock.advance(20 * MIN); // past midnight
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/a.js' } }));
  h.record(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/b.js' } }));
  h.record(ev('Stop'));
  h.flush();
  assert.equal(readDay(dir, '2026-10-28').actions, 1);
  assert.equal(readDay(dir, '2026-10-29').actions, 2);
  assert.equal(readDay(dir, '2026-10-29').tasks, 1, 'a task lands on the day it ends');

  const range = rangeFor('week', clock.now());
  assert.deepEqual(range, { from: '2026-10-23', to: '2026-10-29' });
  const days = h.days(range);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.actions), [0, 0, 0, 0, 0, 1, 2]);
  assert.equal(days[6].filesChanged, 2);
  assert.equal(days[6].files, undefined, 'no file hashes leave the history');
  const s = h.summary(range);
  assert.equal(s.from, '2026-10-23');
  assert.equal(s.days, 7);
  assert.equal(s.actions, 3);
  assert.equal(s.filesChanged, 2, 'a.js changed on both days counts once');
  assert.equal(h.summary({ from: '2026-10-29', to: '2026-10-29' }).actions, 2);
});

test('a corrupt day file is kept aside and the day starts over', () => {
  const { h, dir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-29.json'), '{oops');
  h.record(ev('UserPromptSubmit'));
  h.flush();
  assert.equal(readDay(dir, '2026-10-29').prompts, 1);
  assert.equal(fs.readdirSync(dir).filter((f) => /^2026-10-29\.json\.corrupt-\d+$/.test(f)).length, 1);
});

test('record never throws, whatever it gets', async () => {
  const { h } = setup();
  for (const evt of [null, undefined, 42, {}, { hook_event_name: 5 }, { hook_event_name: 'PreToolUse', tool_input: 'x' }, { hook_event_name: 'Stop', transcript_path: 7 }]) {
    await h.record(evt);
  }
  assert.equal(h.summary().actions, 1);
});

test('rangeFor and eachDate', () => {
  const t = at(12);
  assert.deepEqual(rangeFor('today', t), { from: '2026-10-29', to: '2026-10-29' });
  assert.deepEqual(rangeFor('month', t), { from: '2026-09-30', to: '2026-10-29' });
  assert.equal(rangeFor('year', t), null);
  assert.equal(dateKey(at(0, 0, 1)), '2026-10-01');
  assert.deepEqual(eachDate('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(eachDate('2026-11-02', '2026-10-31'), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(eachDate('2026-02-30', '2026-03-01'), []);
  assert.deepEqual(eachDate('nope', '2026-03-01'), []);
  assert.equal(eachDate('2000-01-01', '2026-10-29').length, 400);
});
