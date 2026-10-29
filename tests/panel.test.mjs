import test from 'node:test';
import assert from 'node:assert/strict';
import { placePanel } from '../src/renderer/js/panel.js';

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
