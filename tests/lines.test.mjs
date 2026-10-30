import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES, VERBS } from '../src/renderer/js/lines/en.js';
import { linesFor, LANGS } from '../src/renderer/js/lines/index.js';

const REQUIRED = ['boot', 'online', 'hello', 'resume', 'prompt', 'working', 'thinkSay', 'thinkLong', 'alert', 'alertHere',
  'error', 'done', 'doneQuiet', 'stopFailure', 'interrupted', 'compact', 'subagentStart', 'subagentStop', 'sessionEnd',
  'linked', 'idle', 'poke', 'pokeIdle', 'dragged', 'dropped', 'landed', 'peekShy', 'zap', 'sleepy', 'wake', 'background', 'back'];
const PLACEHOLDERS = ['project', 'name', 'n', 'time', 'files', 'user', 'stage', 'ai'];

test('every required key is there', () => {
  for (const key of REQUIRED) assert.ok(key in LINES, key);
});

test('every list is long enough and uses known placeholders only', () => {
  for (const [key, list] of Object.entries(LINES)) {
    assert.ok(Array.isArray(list) && list.length >= (['online', 'linked'].includes(key) ? 1 : 3), key);
    for (const line of list) {
      assert.equal(typeof line, 'string', key);
      assert.ok(line.trim().length > 0, key);
      for (const m of line.matchAll(/\{(\w+)\}/g)) assert.ok(PLACEHOLDERS.includes(m[1]), `${key}: {${m[1]}}`);
      assert.ok(!/capri/i.test(line), `${key}: no upstream character name`);
    }
  }
});

test('verbs have a default', () => {
  assert.equal(VERBS.default, 'USES');
  assert.equal(VERBS.Bash, 'RUNS');
});

test('linesFor falls back to English and carries the verbs', () => {
  assert.deepEqual(LANGS, ['en']);
  assert.equal(linesFor('xx').verbs, VERBS);
  assert.equal(linesFor('en').hello, LINES.hello);
});

test('a greeting for every hour of the day', async () => {
  const { greetingKey } = await import('../src/renderer/js/lines/index.js');
  const keys = new Set();
  for (let h = 0; h < 24; h++) {
    const k = greetingKey(h);
    assert.ok(Array.isArray(LINES[k]) && LINES[k].length >= 3, `${h}h: ${k}`);
    keys.add(k);
  }
  assert.equal(greetingKey(2), 'greetLate');
  assert.equal(greetingKey(8), 'greetMorning');
  assert.equal(greetingKey(14), 'greetDay');
  assert.equal(greetingKey(20), 'greetEvening');
  assert.equal(keys.size, 4);
});

test('she has something to say when there is no window to lurk behind', () => {
  assert.ok(LINES.noLurk.length >= 3);
});
