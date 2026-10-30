import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRows, Hud } from '../src/renderer/js/hud.js';

const NOW = 10_000_000;
const sess = (id, extra) => ({ id, project: id, count: 0, files: new Set(), working: false, waiting: false, last: null, seen: NOW - 1000, taskStart: null, ...extra });

test('one row per live session: waiting first, then errors, then working, then done, then idle', () => {
  const rows = sessionRows([
    sess('idle'),
    sess('done', { doneAt: NOW - 5000, lastDuration: 64000 }),
    sess('work', { working: true, taskStart: NOW - 30000, last: { verb: 'EDITS', target: 'gigs.ts' } }),
    sess('wait', { working: true, waiting: true, taskStart: NOW - 9000 }),
    sess('err', { working: true, error: true, taskStart: NOW - 4000, last: { verb: 'RUNS', target: 'npm test' } }),
  ], NOW);
  assert.deepEqual(rows.map((r) => r.id), ['wait', 'err', 'work', 'done', 'idle']);
  assert.deepEqual(rows.map((r) => r.state), ['waiting', 'error', 'working', 'done', 'idle']);
  const work = rows.find((r) => r.id === 'work');
  assert.equal(work.label, 'EDITS gigs.ts');
  assert.equal(work.elapsed, '0:30');
  assert.equal(rows.find((r) => r.id === 'done').elapsed, '1:04');
  assert.equal(rows.find((r) => r.id === 'wait').label, 'WAITING for you');
});

test('working but quiet for a while reads as thinking', () => {
  const [row] = sessionRows([sess('a', { working: true, taskStart: NOW - 60000, seen: NOW - 20000, last: { verb: 'READS', target: 'x' } })], NOW);
  assert.equal(row.state, 'thinking');
});

test('a session quiet for 30 minutes leaves; done turns idle after 10', () => {
  const rows = sessionRows([sess('old', { seen: NOW - 31 * 60000 }), sess('d', { doneAt: NOW - 11 * 60000, seen: NOW - 11 * 60000 })], NOW);
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [['d', 'idle']]);
});

// a document just big enough for the HUD
function fakeDom() {
  const make = (tag) => ({
    tag, children: [], hidden: false, style: {}, className: '', textContent: '', listeners: {},
    offsetWidth: 240, offsetHeight: 34,
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...c) { this.children = c; }, remove() {},
    addEventListener(k, fn) { this.listeners[k] = fn; },
    getBoundingClientRect() { return { left: 2000, top: 40, width: 240, height: this.children.length * 38 }; },
  });
  return { doc: { createElement: make }, root: make('div') };
}

test('the HUD shows from two sessions up, one chip each; a click on a chip picks that session', () => {
  const { doc, root } = fakeDom();
  const picked = [];
  const hud = new Hud({ doc, root, onPick: (id) => picked.push(id) });
  const rows = sessionRows([sess('a', { working: true, taskStart: NOW - 1000 }), sess('b')], NOW);
  hud.update(rows.slice(0, 1));
  assert.equal(hud.box.hidden, true, 'one session: her ticker says it all');
  assert.deepEqual(hud.rects(), []);
  hud.update(rows);
  assert.equal(hud.box.hidden, false);
  assert.equal(hud.box.children.length, 2);
  hud.box.children[1].listeners.click();
  assert.deepEqual(picked, ['b']);
  assert.equal(hud.rects().length, 1);
});

test('labels go in as text', () => {
  const { doc, root } = fakeDom();
  const hud = new Hud({ doc, root });
  hud.update(sessionRows([sess('<img src=x>', { working: true, taskStart: NOW }), sess('b')], NOW));
  const chip = hud.box.children.find((c) => JSON.stringify(c).includes('<img'));
  assert.ok(chip, 'the name is there');
  assert.ok(!('innerHTML' in chip));
});
