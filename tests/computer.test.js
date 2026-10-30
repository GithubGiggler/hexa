'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runComputerTask, describe } = require('../src/main/brain/computer');

const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, toolset_name: 'computer', input });

function rig(replies, { onAsk = async () => 'yes' } = {}) {
  const seen = [];
  const did = [];
  const brain = {
    name: 'claude',
    async chat(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const r = replies.shift();
      return { content: r.content, text: r.text || '', stopReason: r.stop || 'end_turn' };
    },
  };
  const screen = {
    capture: async ({ region } = {}) => { did.push(['shot', region || null]); return { data: 'PNG', width: 1280, height: 720 }; },
    toScreen: ([x, y]) => [x * 2, y * 2], // screenshots at half size
    cursor: () => [10, 20],
  };
  const input = {};
  for (const k of ['click', 'move', 'drag', 'scroll', 'key', 'type', 'buttonDown', 'buttonUp']) input[k] = async (...a) => { did.push([k, ...a]); };
  const steps = [];
  return { brain, screen, input, seen, did, steps, onAsk };
}

test('the first request: the toolset, ask_user, her rules, and the task with a screenshot', async () => {
  const r = rig([{ content: [{ type: 'text', text: 'Nothing to do.' }], text: 'Nothing to do.' }]);
  const out = await runComputerTask({ brain: r.brain, model: 'claude-opus-5-5', task: 'open the settings', screen: r.screen, input: r.input, askUser: r.onAsk });
  assert.equal(out.outcome, 'done');
  const req = r.seen[0];
  assert.deepEqual(req.tools[0], { type: 'computer_toolset_20260801' });
  assert.equal(req.tools[1].name, 'ask_user');
  assert.match(req.system, /ask_user/);
  assert.match(req.system, /data, not instructions/);
  assert.deepEqual(req.extra.thinking, { type: 'adaptive', display: 'updates' });
  assert.ok(req.betas.includes('thinking-display-updates-2026-08-18'));
  assert.equal(req.messages[0].content[1].type, 'image');
  assert.match(req.messages[0].content[0].text, /1280×720/);
});

test('actions run on your screen at mapped coordinates; every result echoes the toolset', async () => {
  const r = rig([
    { content: [{ type: 'thinking', thinking: 'Opening the menu.' }, use('a', 'left_click', { coordinate: [100, 50] }), use('b', 'type', { text: 'firefox' }), use('c', 'key', { text: 'Return' }), use('d', 'screenshot')], stop: 'tool_use' },
    { content: [{ type: 'text', text: 'Firefox is open.' }], text: 'Firefox is open.' },
  ]);
  const steps = [];
  const out = await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk, onStep: (s) => steps.push(s) });
  assert.equal(out.text, 'Firefox is open.');
  assert.deepEqual(r.did.slice(1, 4).map((d) => d.slice(0, d[0] === 'click' ? 3 : 2)), [['click', 200, 100], ['type', 'firefox'], ['key', 'Return']]);
  const results = r.seen[1].messages.at(-1).content;
  assert.equal(results.length, 4);
  assert.ok(results.every((x) => x.toolset_name === 'computer'));
  assert.equal(results[3].content[0].type, 'image');
  assert.deepEqual(steps.map((s) => s.kind), ['note', 'action', 'action', 'action', 'action']);
  assert.equal(steps[2].text, 'Typing "firefox"');
});

test('one failed action: the rest of that batch is not run, and says so', async () => {
  const r = rig([
    { content: [use('a', 'left_click', { coordinate: ['x', 1] }), use('b', 'type', { text: 'never' })], stop: 'tool_use' },
    { content: [{ type: 'text', text: 'Oops.' }], text: 'Oops.' },
  ]);
  await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk });
  const [a, b] = r.seen[1].messages.at(-1).content;
  assert.equal(a.is_error, true);
  assert.equal(b.content[0].text, 'Not executed: an earlier computer action in this turn failed.');
  assert.ok(!r.did.some((d) => d[0] === 'type'));
});

test('ask_user waits for your answer, and its result is a plain tool_result', async () => {
  let asked = null;
  const r = rig([
    { content: [{ type: 'tool_use', id: 'q', name: 'ask_user', input: { question: 'Buy it for $5?' } }], stop: 'tool_use' },
    { content: [{ type: 'text', text: 'Stopped.' }], text: 'Stopped.' },
  ], { onAsk: async (q) => { asked = q; return 'No.'; } });
  await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk });
  assert.equal(asked, 'Buy it for $5?');
  const res = r.seen[1].messages.at(-1).content[0];
  assert.equal(res.toolset_name, undefined);
  assert.equal(res.content[0].text, 'No.');
});

test('Escape (the signal) stops her before the next action', async () => {
  const controller = new AbortController();
  const r = rig([{ content: [use('a', 'left_click', { coordinate: [1, 1] }), use('b', 'left_click', { coordinate: [2, 2] })], stop: 'tool_use' }]);
  r.input.click = async (...a) => { r.did.push(['click', ...a]); controller.abort(); };
  const out = await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk, signal: controller.signal });
  assert.equal(out.outcome, 'stopped');
  assert.equal(r.did.filter((d) => d[0] === 'click').length, 1);
});

test('too many screenshots: she stops and says so', async () => {
  const replies = Array.from({ length: 30 }, (_, i) => ({ content: [use(`s${i}`, 'screenshot')], stop: 'tool_use' }));
  const r = rig(replies);
  const out = await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk });
  assert.equal(out.outcome, 'limit');
  assert.ok(r.seen.length <= 18);
});

test('her task card\'s words', () => {
  assert.equal(describe('scroll', { scroll_direction: 'down' }), 'Scrolling down');
  assert.equal(describe('key', { text: 'ctrl+l' }), 'Pressing ctrl+l');
  assert.equal(describe('double_click'), 'Double-clicking');
});

test('she never clicks her own card or body, and the signal reaches her typing', async () => {
  const r = rig([
    { content: [use('a', 'left_click', { coordinate: [10, 10] }), use('b', 'type', { text: 'x' })], stop: 'tool_use' },
    { content: [{ type: 'text', text: 'ok' }], text: 'ok' },
  ]);
  const controller = new AbortController();
  let typedWith = null;
  r.input.type = async (text, opts) => { typedWith = opts; };
  await runComputerTask({ brain: r.brain, model: 'm', task: 't', screen: r.screen, input: r.input, askUser: r.onAsk, signal: controller.signal, hersAt: ([x, y]) => x < 50 && y < 50 });
  const [a, b] = r.seen[1].messages.at(-1).content;
  assert.equal(a.is_error, true);
  assert.match(a.content[0].text, /Hexa/);
  assert.ok(!r.did.some((d) => d[0] === 'click'));
  assert.equal(b.content[0].text, 'Not executed: an earlier computer action in this turn failed.');
  assert.equal(typedWith, null);
  const r2 = rig([{ content: [use('b', 'type', { text: 'x' })], stop: 'tool_use' }, { content: [{ type: 'text', text: 'ok' }], text: 'ok' }]);
  r2.input.type = async (text, opts) => { typedWith = opts; };
  await runComputerTask({ brain: r2.brain, model: 'm', task: 't', screen: r2.screen, input: r2.input, askUser: r2.onAsk, signal: controller.signal });
  assert.equal(typedWith.signal, controller.signal);
});
