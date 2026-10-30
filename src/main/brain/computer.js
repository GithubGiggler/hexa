'use strict';

// Computer use: she does one task you asked for with your mouse and keyboard (Claude only, the
// computer toolset). Started only after your Start on her consent card; Escape stops it at any
// moment (signal). Her progress notes and actions go to her task card (onStep). Before anything
// consequential she has to ask you (the ask_user tool). Screenshots are scaled to fit the model's
// limits, and its coordinates are mapped back to your screen.

const { COMPUTER_SYSTEM } = require('./persona');

const MAX_SHOTS = 18;     // a request holds 20 images at most; past this she stops and asks
const MAX_ACTIONS = 80;
const BETAS = ['thinking-display-updates-2026-08-18'];
const NOT_RUN = 'Not executed: an earlier computer action in this turn failed.';

const ASK_USER = {
  name: 'ask_user',
  description: 'Ask the user a question and wait for their answer. Required before anything consequential (paying, logging in, sending, deleting, accepting terms, installing).',
  input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
  strict: true,
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// what each member does, in her task card's words
function describe(name, input = {}) {
  switch (name) {
    case 'screenshot': return 'Looking at the screen';
    case 'zoom': return 'Looking closer';
    case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click':
      return `${{ left_click: 'Clicking', right_click: 'Right-clicking', middle_click: 'Middle-clicking', double_click: 'Double-clicking', triple_click: 'Triple-clicking' }[name]}`;
    case 'left_click_drag': return 'Dragging';
    case 'mouse_move': return 'Moving the pointer';
    case 'scroll': return `Scrolling ${input.scroll_direction || ''}`.trim();
    case 'type': return `Typing "${clip(String(input.text || ''), 40)}"`;
    case 'key': return `Pressing ${input.text}`;
    case 'hold_key': return `Holding ${input.text}`;
    case 'wait': return 'Waiting';
    default: return name.replace(/_/g, ' ');
  }
}

// One member of the toolset, on your screen. map: screenshot coords -> root (physical) coords;
// hersAt([x, y]): is that her own card or body? (she never clicks those: your answers are yours)
async function perform(name, input, { input: hands, screen, map, wait, signal, hersAt = () => false }) {
  const at = (c) => {
    if (!(Array.isArray(c) && c.length === 2 && c.every(Number.isFinite))) return null;
    const p = map(c);
    if (hersAt(p)) throw new Error('That is Hexa herself or her card: not something to click.');
    return p;
  };
  const coord = input.coordinate !== undefined ? at(input.coordinate) : undefined;
  if (input.coordinate !== undefined && !coord) throw new Error('bad coordinate');
  const mods = typeof input.text === 'string' && name !== 'type' && name !== 'key' && name !== 'hold_key' ? input.text : '';
  switch (name) {
    case 'screenshot': return { image: await screen.capture() };
    case 'zoom': {
      const r = input.region;
      if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) throw new Error('bad region');
      return { image: await screen.capture({ region: r }) };
    }
    case 'left_click': await hands.click(coord?.[0], coord?.[1], { modifiers: mods }); break;
    case 'right_click': await hands.click(coord?.[0], coord?.[1], { button: 'right', modifiers: mods }); break;
    case 'middle_click': await hands.click(coord?.[0], coord?.[1], { button: 'middle', modifiers: mods }); break;
    case 'double_click': await hands.click(coord?.[0], coord?.[1], { count: 2, modifiers: mods }); break;
    case 'triple_click': await hands.click(coord?.[0], coord?.[1], { count: 3, modifiers: mods }); break;
    case 'left_click_drag': {
      const from = at(input.start_coordinate);
      if (!from || !coord) throw new Error('bad coordinate');
      await hands.drag(from, coord, { modifiers: mods });
      break;
    }
    case 'mouse_move': if (!coord) throw new Error('bad coordinate'); await hands.move(coord[0], coord[1]); break;
    case 'left_mouse_down': await hands.buttonDown('left'); break;
    case 'left_mouse_up': await hands.buttonUp('left'); break;
    case 'cursor_position': return { text: JSON.stringify(screen.cursor()) };
    case 'scroll': await hands.scroll(input.scroll_direction, Number(input.scroll_amount) || 3, coord, { modifiers: mods }); break;
    case 'type': if (typeof input.text !== 'string') throw new Error('nothing to type'); await hands.type(input.text, { signal }); break;
    case 'key': await hands.key(String(input.text || ''), { repeat: Number(input.repeat) || 1, signal }); break;
    case 'hold_key': await hands.key(String(input.text || ''), { holdMs: Math.min(5, Math.max(0, Number(input.duration) || 0)) * 1000, signal }); break;
    case 'wait': await wait(Math.min(30, Math.max(0, Number(input.duration) || 1)) * 1000, signal); break;
    default: throw new Error(`no computer action "${name}"`);
  }
  return { text: 'OK' };
}

function resultFor(id, out, toolset = true) {
  const base = { type: 'tool_result', tool_use_id: id, ...(toolset ? { toolset_name: 'computer' } : {}) };
  if (out.error) return { ...base, is_error: true, content: [{ type: 'text', text: out.error }] };
  if (out.image) return { ...base, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: out.image.data } }] };
  return { ...base, content: [{ type: 'text', text: out.text || 'OK' }] };
}

// brain: claudeBrain; screen: { capture({ region }) -> { data, width, height }, toScreen([x, y]) -> [x, y], cursor() };
// input: createInput(...); askUser(question) -> Promise<string>; onStep({ kind, text }).
// a wait Escape cuts short
const pause = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

async function runComputerTask({ brain, model, task, screen, input, askUser, onStep = () => {}, signal, wait = pause, hersAt, system = COMPUTER_SYSTEM }) {
  const first = await screen.capture();
  let shots = 1;
  let actions = 0;
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: `The task: ${task}\nThe screen is ${first.width}×${first.height} in the screenshots (coordinates in that space). Here it is now.` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: first.data } },
    ],
  }];
  const ctx = { input, screen, map: (c) => screen.toScreen(c), wait, signal, hersAt };
  for (;;) {
    if (signal?.aborted) return { outcome: 'stopped' };
    const r = await brain.chat({
      model, system, messages, signal, effort: 'medium',
      tools: [{ type: 'computer_toolset_20260801' }, ASK_USER],
      betas: BETAS, extra: { thinking: { type: 'adaptive', display: 'updates' } },
    });
    messages.push({ role: 'assistant', content: r.content });
    for (const b of r.content) if (b.type === 'thinking' && b.thinking?.trim()) onStep({ kind: 'note', text: clip(b.thinking.trim(), 160) });
    if (r.stopReason === 'refusal') return { outcome: 'refused', text: r.text };
    const calls = r.content.filter((b) => b.type === 'tool_use');
    if (r.stopReason !== 'tool_use' || !calls.length) return { outcome: 'done', text: r.text };

    const results = [];
    let failed = false;
    for (const call of calls) {
      if (signal?.aborted) return { outcome: 'stopped' };
      if (call.name === 'ask_user') {
        const q = String(call.input?.question || '').slice(0, 500);
        onStep({ kind: 'ask', text: q });
        const answer = await askUser(q);
        results.push(resultFor(call.id, { text: answer || 'No answer: do not do it.' }, false));
        continue;
      }
      if (failed) {
        results.push(resultFor(call.id, { error: NOT_RUN }));
        continue;
      }
      if (++actions > MAX_ACTIONS) return { outcome: 'limit', text: 'That took a lot of steps: I stopped. Ask me again to keep going.' };
      onStep({ kind: 'action', text: describe(call.name, call.input) });
      try {
        const out = await perform(call.name, call.input || {}, ctx);
        if (out.image && ++shots > MAX_SHOTS) return { outcome: 'limit', text: 'I\'ve looked at the screen a lot for this one: I stopped. Ask me again to keep going.' };
        results.push(resultFor(call.id, out));
      } catch (err) {
        failed = true;
        results.push(resultFor(call.id, { error: err.message }));
      }
    }
    messages.push({ role: 'user', content: results });
  }
}

module.exports = { runComputerTask, perform, describe, resultFor, ASK_USER, MAX_SHOTS };
