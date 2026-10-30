'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readNew, addModels, totalOf } = require('../src/main/usage/transcript');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-transcript-'));
const SECRET = 'the user said: my password is hunter2';

// A transcript line the way Claude Code writes them: one per content block of an assistant message.
function assistant(id, model, usage, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: extra.timestamp || '2026-10-29T10:00:00.000Z',
    sessionId: 's1',
    message: {
      id, model, role: 'assistant', type: 'message',
      content: [{ type: 'text', text: extra.text || SECRET }],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
    },
  });
}
const user = (text = SECRET) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const lines = (...ls) => ls.map((l) => l + '\n').join('');

test('sums usage per model, each message once even across its content-block lines', async () => {
  const file = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(file, lines(
    user(),
    assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
    // the same message again, its output having grown while it streamed
    assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 40, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
    assistant('msg_2', 'claude-opus-5-5', { input_tokens: 3, output_tokens: 7 }),
    assistant('msg_3', 'claude-haiku-5-5', { input_tokens: 50, output_tokens: 2 }),
  ));
  const r = await readNew(file);
  assert.deepEqual(r.models['claude-opus-5-5'], { input: 13, output: 47, cacheWrite: 100, cacheWrite1h: 0, cacheRead: 1000, messages: 2 });
  assert.deepEqual(r.models['claude-haiku-5-5'], { input: 50, output: 2, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1 });
  assert.equal(r.lines, 5);
  assert.equal(r.bad, 0);
  assert.equal(r.state.offset, fs.statSync(file).size);
});

test('reads only the new lines on the next call, and counts a message id once across calls', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const seen = new Map();
  fs.writeFileSync(file, lines(assistant('msg_1', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 5 })));
  const first = await readNew(file, { seen });
  assert.equal(first.models['claude-sonnet-5-5'].output, 5);

  const again = await readNew(file, { state: first.state, seen });
  assert.deepEqual(again.models, {}, 'nothing new, nothing counted');
  assert.equal(again.lines, 0);

  fs.appendFileSync(file, lines(
    assistant('msg_1', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 9 }), // its last block: 4 more
    assistant('msg_2', 'claude-sonnet-5-5', { input_tokens: 1, output_tokens: 1 }),
  ));
  const next = await readNew(file, { state: again.state, seen });
  assert.deepEqual(next.models['claude-sonnet-5-5'], { input: 1, output: 5, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1 });
  assert.equal(next.lines, 2);
});

test('a partial last line waits for its newline', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const line = assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5 });
  fs.writeFileSync(file, lines(user()) + line.slice(0, 40));
  const first = await readNew(file);
  assert.deepEqual(first.models, {});
  assert.equal(first.bad, 0, 'half a line is not malformed, just unfinished');
  assert.equal(first.state.offset, Buffer.byteLength(lines(user())));

  fs.appendFileSync(file, line.slice(40) + '\n');
  const second = await readNew(file, { state: first.state });
  assert.equal(second.models['claude-opus-5-5'].input, 10);
  assert.equal(second.state.offset, fs.statSync(file).size);
});

test('a truncated file starts over; ids already counted stay counted once', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const seen = new Map();
  fs.writeFileSync(file, lines(
    assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5 }),
    assistant('msg_2', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5 }),
  ));
  const first = await readNew(file, { seen });
  fs.writeFileSync(file, lines(
    assistant('msg_2', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5 }),
    assistant('msg_9', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 1 }, { text: '' }),
  ));
  assert.ok(fs.statSync(file).size < first.state.offset);
  const r = await readNew(file, { state: first.state, seen });
  assert.equal(r.reset, true);
  assert.deepEqual(r.models['claude-opus-5-5'], { input: 1, output: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1 });
});

test('a rotated file (another file under the same name) starts over', async () => {
  const dir = tmp();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines(assistant('msg_1', 'claude-opus-5-5', { output_tokens: 5 })));
  const first = await readNew(file);
  const other = path.join(dir, 'new.jsonl');
  fs.writeFileSync(other, lines(
    assistant('msg_7', 'claude-opus-5-5', { output_tokens: 2 }),
    assistant('msg_8', 'claude-opus-5-5', { output_tokens: 3 }),
  ));
  fs.renameSync(other, file);
  const r = await readNew(file, { state: first.state });
  assert.equal(r.reset, true);
  assert.equal(r.models['claude-opus-5-5'].output, 5);
});

test('malformed lines are skipped and counted', async () => {
  const file = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(file, lines(
    '{"type":"assistant","message":{"usage":{"input_tokens":5', // cut off
    'not json at all',
    '',
    JSON.stringify({ type: 'assistant', message: { id: 'x', model: 'claude-opus-5-5', usage: 'nope' } }),
    JSON.stringify({ type: 'user', message: { usage: { input_tokens: 99 } } }), // only assistant messages count
    assistant('msg_1', 'claude-opus-5-5', { input_tokens: 4, output_tokens: -3 }),
  ));
  const r = await readNew(file);
  assert.equal(r.bad, 1);
  assert.deepEqual(r.models['claude-opus-5-5'], { input: 4, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1 });
});

test('no text from the transcript comes out; odd model names become "unknown"', async () => {
  const file = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(file, lines(
    user(),
    assistant('msg_1', 'claude-opus-5-5', { input_tokens: 1 }),
    assistant('msg_2', `<script>${SECRET}</script>`, { input_tokens: 2 }),
    assistant('msg_3', 'x'.repeat(200), { input_tokens: 3 }),
  ));
  const r = await readNew(file);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('hunter2'));
  assert.ok(!json.includes('msg_'), 'message ids stay in the caller-held map, not the result');
  assert.deepEqual(Object.keys(r.models).sort(), ['claude-opus-5-5', 'unknown']);
  assert.equal(r.models.unknown.input, 5);
});

test('lines stamped before `since` are marked seen but not counted', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const seen = new Map();
  fs.writeFileSync(file, lines(
    assistant('msg_old', 'claude-opus-5-5', { output_tokens: 100 }, { timestamp: '2026-10-28T23:00:00.000Z' }),
    assistant('msg_new', 'claude-opus-5-5', { output_tokens: 5 }, { timestamp: '2026-10-29T08:00:00.000Z' }),
  ));
  const r = await readNew(file, { seen, since: Date.parse('2026-10-29T00:00:00.000Z') });
  assert.equal(r.models['claude-opus-5-5'].output, 5);
  assert.ok(seen.has('msg_old'));
});

test('a message copied into another transcript counts once when the map is shared', async () => {
  const dir = tmp();
  const seen = new Map();
  const a = path.join(dir, 'a.jsonl');
  const b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, lines(assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10 })));
  fs.writeFileSync(b, lines(assistant('msg_1', 'claude-opus-5-5', { input_tokens: 10 }), assistant('msg_2', 'claude-opus-5-5', { input_tokens: 1 })));
  await readNew(a, { seen });
  const r = await readNew(b, { seen });
  assert.equal(r.models['claude-opus-5-5'].input, 1);
});

test('the oldest remembered ids are dropped past the limit', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const seen = new Map();
  fs.writeFileSync(file, lines(...[1, 2, 3, 4].map((i) => assistant(`msg_${i}`, 'claude-opus-5-5', { input_tokens: 1 }))));
  await readNew(file, { seen, maxSeen: 2 });
  assert.deepEqual([...seen.keys()], ['msg_3', 'msg_4']);
});

test('one-hour cache writes, long prompts and synthetic messages', async () => {
  const file = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(file, lines(
    assistant('msg_1', 'claude-haiku-5-5', { input_tokens: 10, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } }),
    assistant('msg_2', 'claude-haiku-5-5', { input_tokens: 1000, cache_read_input_tokens: 150000, output_tokens: 10 }),
    assistant('msg_3', '<synthetic>', { input_tokens: 0 }),
  ));
  const r = await readNew(file);
  const h = r.models['claude-haiku-5-5'];
  assert.equal(h.cacheWrite, 300);
  assert.equal(h.cacheWrite1h, 200);
  assert.deepEqual(h.long, { input: 1000, output: 10, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 150000, messages: 1 });
  assert.equal(r.models['<synthetic>'], undefined);
  assert.equal(r.models.unknown, undefined);
});

test('a line bigger than a read chunk is put back together', async () => {
  const file = path.join(tmp(), 't.jsonl');
  const big = assistant('msg_big', 'claude-opus-5-5', { input_tokens: 7, output_tokens: 3 }, { text: 'y'.repeat(2.5 * 1024 * 1024) });
  fs.writeFileSync(file, lines(user('z'.repeat(1024 * 1024 + 17)), big, assistant('msg_2', 'claude-opus-5-5', { input_tokens: 1 })));
  const r = await readNew(file);
  assert.equal(r.bad, 0);
  assert.equal(r.models['claude-opus-5-5'].input, 8);
  assert.equal(r.models['claude-opus-5-5'].messages, 2);
  assert.equal(r.state.offset, fs.statSync(file).size);
});

test('a missing file reads as nothing and keeps its state', async () => {
  const r = await readNew(path.join(tmp(), 'gone.jsonl'), { state: { offset: 42, ino: 7 } });
  assert.equal(r.missing, true);
  assert.deepEqual(r.state, { offset: 42, ino: 7 });
  assert.deepEqual(r.models, {});
});

test('addModels and totalOf', () => {
  const a = { m: { input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 1, cacheRead: 4, messages: 1 } };
  addModels(a, { m: { input: 1, output: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1, long: { input: 1, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 1 } }, n: { input: 5 } });
  assert.equal(a.m.input, 2);
  assert.equal(a.m.messages, 2);
  assert.equal(a.m.long.input, 1);
  assert.equal(a.n.input, 5);
  assert.equal(totalOf(a.m), 2 + 3 + 3 + 4);
});
