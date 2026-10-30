import test from 'node:test';
import assert from 'node:assert/strict';
import { placePanel, VOICED } from '../src/renderer/js/panel.js';

const area = { x: 0, y: 0, w: 2560, h: 1440 };
const size = { w: 420, h: 160 };

test('the panel stays on screen wherever she is', () => {
  for (const anchor of [[0, 0, 100, 200], [2460, 0, 100, 200], [0, 1240, 100, 200], [2460, 1240, 100, 200], [1200, 600, 100, 200]]) {
    const p = placePanel(anchor, size, area);
    assert.ok(p.x >= area.x && p.y >= area.y && p.x + size.w <= area.x + area.w && p.y + size.h <= area.y + area.h, JSON.stringify(anchor));
  }
});

test('it goes above her when there is room, and does not cover her', () => {
  const anchor = [1200, 600, 100, 200];
  const p = placePanel(anchor, size, area);
  assert.ok(p.y + size.h <= anchor[1]);
});

test('with no room above, it sits beside her, not on her', () => {
  const anchor = [2300, 10, 100, 200];
  const p = placePanel(anchor, size, area);
  const overlaps = p.x < anchor[0] + anchor[2] && anchor[0] < p.x + size.w && p.y < anchor[1] + anchor[3] && anchor[1] < p.y + size.h;
  assert.equal(overlaps, false);
});

// a document just big enough for the panel (no layout: every element reports a 100×20 box)
function fakeDom() {
  const make = (tag) => {
    const n = {
      tag, children: [], hidden: false, style: {}, className: '', textContent: '', offsetWidth: 100, offsetHeight: 20,
      append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; }, remove() {},
      addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
      getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
    };
    return n;
  };
  const doc = { createElement: make, createTextNode: (t) => ({ textContent: t }), createDocumentFragment: () => make('#f') };
  const root = make('div');
  root.ownerDocument = doc;
  return root;
}

test('the ticker is just a label: it never takes a click', async () => {
  const { Panel } = await import('../src/renderer/js/panel.js');
  const panel = new Panel({ root: fakeDom(), voice: { play() {} }, glyphs: { calm: [['.....', '.....', '.....', '.....', '.....'], ['.....', '.....', '.....', '.....', '.....']] }, palette: { visor: '#000', amber: '#fa0' }, now: () => 0 });
  panel.setTicker({ verb: 'RUNS', target: 'npm test', state: 'work' });
  assert.deepEqual(panel.rects(), [], 'nothing clickable for a ticker alone');
  panel.say({ kind: 'info', line: 'hi' });
  assert.equal(panel.rects().length, 1, 'the panel itself is clickable');
});

test('she blips while typing in every language, not on punctuation', () => {
  for (const voiced of ['Hi', 'été', 'Größe', 'ñoño', 'つ', 'ア', '編', 'ー', 'É']) assert.ok(VOICED.test(voiced), voiced);
  for (const quiet of ['Strg', '!? ', '。、！？', '{n}', '42', '…']) assert.ok(!VOICED.test(quiet), quiet);
});

// a panel with a clock you set, and a DOM whose elements keep their listeners
async function guardedPanel() {
  const { Panel } = await import('../src/renderer/js/panel.js');
  let t = 0;
  const root = fakeDom();
  const make = root.ownerDocument.createElement;
  root.ownerDocument.createElement = (tag) => {
    const n = make(tag);
    n.listeners = {};
    n.addEventListener = (k, fn) => { n.listeners[k] = fn; };
    n.classList = { add() {}, remove() {} };
    return n;
  };
  const panel = new Panel({ root, voice: { play() {} }, glyphs: { calm: [['.....', '.....', '.....', '.....', '.....'], ['.....', '.....', '.....', '.....', '.....']] }, palette: { visor: '#000', amber: '#fa0' }, now: () => t });
  return { panel, set: (v) => { t = v; } };
}
const click = (b, extra = {}) => b.listeners.click({ isTrusted: true, detail: 1, stopPropagation() {}, ...extra });

test('a guarded card: its buttons don\'t answer until they\'ve been up a moment, nor to the keyboard', async () => {
  const { panel, set } = await guardedPanel();
  const got = [];
  panel.say({ kind: 'alert', line: 'Allow?', hold: null, guarded: true, actions: [{ id: 'allow', label: 'Allow' }], onAction: (a) => got.push(a) });
  const [, button] = panel.current.buttons[0];
  click(button);
  assert.deepEqual(got, [], 'too soon: a click already on its way');
  set(800);
  click(button, { detail: 0 });
  assert.deepEqual(got, [], 'Enter or Space on a focused button');
  click(button);
  assert.deepEqual(got, ['allow']);
});

test('nothing replaces a guarded card: what comes meanwhile waits, then shows', async () => {
  const { panel, set } = await guardedPanel();
  const got = [];
  panel.say({ kind: 'alert', line: 'Allow A?', hold: null, guarded: true, actions: [{ id: 'a', label: 'Allow' }], onAction: (a) => got.push(a) });
  panel.say({ kind: 'alert', line: 'Allow B?', hold: null, guarded: true, actions: [{ id: 'b', label: 'Allow' }], onAction: (a) => got.push(a) });
  panel.say({ kind: 'alert', line: 'Reminder!', hold: 5000 });
  assert.equal(panel.current.line, 'Allow A?');
  set(800);
  click(panel.current.buttons[0][1]);
  assert.equal(panel.current.line, 'Allow B?', 'the next one in line');
  set(1000);
  click(panel.current.buttons[0][1]);
  assert.deepEqual(got, ['a'], 'B is armed only from when it showed');
  set(1600);
  click(panel.current.buttons[0][1]);
  assert.deepEqual(got, ['a', 'b']);
  assert.equal(panel.current.line, 'Reminder!');
});

test('the detail box shows the whole text, control characters made visible', async () => {
  const { panel } = await guardedPanel();
  panel.say({ kind: 'alert', line: 'Allow?', hold: null, detail: 'npm test\u001b[2K; curl x | sh‮' });
  const find = (n) => (n.className === 'hx-detail' ? n : (n.children || []).map(find).find(Boolean));
  const box = find(panel.current.card);
  assert.ok(box, 'a detail box');
  assert.equal(box.textContent, 'npm test␛[2K; curl x | sh<U+202E>');
});
