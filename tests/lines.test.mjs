import test from 'node:test';
import assert from 'node:assert/strict';
import * as en from '../src/renderer/js/lines/en.js';
import * as de from '../src/renderer/js/lines/de.js';
import * as fr from '../src/renderer/js/lines/fr.js';
import * as es from '../src/renderer/js/lines/es.js';
import * as ja from '../src/renderer/js/lines/ja.js';
import { linesFor, LANGS } from '../src/renderer/js/lines/index.js';
import labels from '../src/main/labels.js';

const { LINES, VERBS } = en;
const TABLES = { en, de, fr, es, ja };

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
  assert.deepEqual(LANGS, ['en', 'de', 'fr', 'es', 'ja']);
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

// ---- every language (docs/translating.md) ----

const keys = (o) => Object.keys(o).sort();
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// no upstream character name, in any script
const UPSTREAM = /capri|カプリ/i;
// how wide a line types out: CJK and full-width characters take two columns
const width = (text) => [...text].reduce((w, c) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);

test('the main process and the renderer know the same languages', () => {
  assert.deepEqual(labels.LANGS, LANGS);
  assert.deepEqual(Object.keys(TABLES), LANGS);
});

for (const [lang, table] of Object.entries(TABLES)) {
  test(`${lang}: has every key English has, and nothing else`, () => {
    for (const part of ['LINES', 'VERBS', 'GUIDE', 'BUTTONS']) assert.ok(table[part], `${lang}.${part}`);
    assert.deepEqual(keys(table.LINES), keys(LINES));
    assert.deepEqual(keys(table.VERBS), keys(VERBS));
    assert.deepEqual(keys(table.GUIDE), keys(en.GUIDE));
    assert.deepEqual(keys(table.GUIDE.topics), keys(en.GUIDE.topics));
    assert.deepEqual(keys(table.BUTTONS), keys(en.BUTTONS));
    for (const key of REQUIRED) assert.ok(key in table.LINES, `${lang}: ${key}`);
  });

  test(`${lang}: every list is long enough, uses known placeholders and her own name`, () => {
    for (const [key, list] of Object.entries(table.LINES)) {
      assert.ok(Array.isArray(list) && list.length >= (['online', 'linked'].includes(key) ? 1 : 3), `${lang}: ${key}`);
      for (const line of list) {
        assert.equal(typeof line, 'string', `${lang}: ${key}`);
        assert.ok(line.trim().length > 0, `${lang}: ${key}`);
        for (const name of placeholders(line)) assert.ok(PLACEHOLDERS.includes(name), `${lang}: ${key}: {${name}}`);
        assert.ok(!UPSTREAM.test(line), `${lang}: ${key}: no upstream character name`);
      }
    }
  });

  test(`${lang}: lines are about as short as the English ones`, () => {
    for (const [key, list] of Object.entries(table.LINES)) {
      const most = Math.max(...LINES[key].map(width));
      for (const line of list) assert.ok(width(line) <= most * 1.5, `${lang}: ${key}: "${line}" (${width(line)} > 1.5 × ${most})`);
    }
  });

  test(`${lang}: the guide and the card buttons keep their placeholders`, () => {
    const strings = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v]] : strings(v, `${prefix}${k}.`)));
    const english = Object.fromEntries([...strings(en.GUIDE), ...strings(en.BUTTONS, 'buttons.')]);
    for (const [key, text] of [...strings(table.GUIDE), ...strings(table.BUTTONS, 'buttons.')]) {
      assert.ok(text.trim().length > 0, `${lang}: ${key}`);
      assert.deepEqual(placeholders(text), placeholders(english[key]), `${lang}: ${key}`);
      assert.ok(!UPSTREAM.test(text), `${lang}: ${key}: no upstream character name`);
    }
  });

  test(`${lang}: ticker verbs are short and loud`, () => {
    for (const [tool, verb] of Object.entries(table.VERBS)) {
      assert.ok(verb.length > 0 && verb.length <= 10, `${lang}: ${tool}: ${verb}`);
      assert.equal(verb, verb.toUpperCase(), `${lang}: ${tool}: uppercase in Latin scripts`);
    }
  });

  test(`${lang}: linesFor gives her own table, and the guide names the menu item it means`, () => {
    const t = linesFor(lang);
    assert.equal(t.hello, table.LINES.hello);
    assert.equal(t.verbs, table.VERBS);
    assert.deepEqual(t.guide, table.GUIDE);
    assert.deepEqual(t.buttons, table.BUTTONS);
    // "my menu › Remove Claude Code hooks" has to be what her menu really says
    assert.ok(table.GUIDE.folderHow.includes(labels.trayLabels(lang).hooksRemove), `${lang}: folderHow`);
  });
}

test('French punctuation never wraps onto a line of its own', () => {
  for (const text of [...Object.values(fr.LINES).flat(), fr.GUIDE.menuLine, fr.GUIDE.restart]) {
    assert.ok(!/ [:;!?]/.test(text), text);
  }
  assert.ok(fr.LINES.done[0].includes('0\u00a0!'));
});
