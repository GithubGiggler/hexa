import test from 'node:test';
import assert from 'node:assert/strict';
import { placeMenu, nextItem } from '../src/renderer/js/menu.js';

const area = { x: 0, y: 0, w: 2560, h: 1440 };
const size = { w: 240, h: 420 };

test('her menu opens down and right of the pointer when there is room', () => {
  assert.deepEqual(placeMenu({ x: 500, y: 300 }, size, area), { x: 500, y: 300 });
});

test('near the right or bottom edge it opens the other way, and always stays on screen', () => {
  assert.deepEqual(placeMenu({ x: 2500, y: 1400 }, size, area), { x: 2500 - 240, y: 1400 - 420 });
  for (const at of [{ x: 0, y: 0 }, { x: 2560, y: 1440 }, { x: 100, y: 1430 }, { x: 2550, y: 10 }]) {
    const p = placeMenu(at, size, area);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + size.w <= 2560 && p.y + size.h <= 1440, JSON.stringify(at));
  }
});

test('a submenu opens beside its item, on the side with room', () => {
  const item = { x: 500, y: 300, w: 240, h: 30 };
  assert.deepEqual(placeMenu({ x: item.x + item.w, y: item.y }, { w: 200, h: 120 }, area, item), { x: 740, y: 300 });
  const right = { x: 2300, y: 300, w: 240, h: 30 };
  assert.equal(placeMenu({ x: right.x + right.w, y: right.y }, { w: 200, h: 120 }, area, right).x, 2300 - 200);
});

test('the arrow keys skip separators and disabled items, and wrap', () => {
  const items = [
    { type: 'normal', enabled: false }, { type: 'separator' }, { type: 'normal' }, { type: 'checkbox' },
    { type: 'separator' }, { type: 'normal' },
  ];
  assert.equal(nextItem(items, -1, 1), 2);
  assert.equal(nextItem(items, 2, 1), 3);
  assert.equal(nextItem(items, 3, 1), 5);
  assert.equal(nextItem(items, 5, 1), 2, 'wraps to the first it can pick');
  assert.equal(nextItem(items, 2, -1), 5);
  assert.equal(nextItem([{ type: 'separator' }], -1, 1), -1, 'nothing to pick');
});

test('Up with nothing picked lands on the last item', () => {
  const items = [{ type: 'normal' }, { type: 'separator' }, { type: 'normal' }];
  assert.equal(nextItem(items, -1, -1), 2);
});

import { Menu } from '../src/renderer/js/menu.js';

// just enough DOM: elements with listeners, classes and a fixed 200×30 box
function fakeDom() {
  const make = (tag) => {
    const n = {
      tag, children: [], hidden: false, style: {}, className: '', textContent: '', offsetWidth: 200, offsetHeight: 120,
      listeners: {}, removed: false,
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
      append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; }, remove() { this.removed = true; },
      addEventListener(k, fn) { this.listeners[k] = fn; }, getBoundingClientRect: () => ({ left: 10, top: 10, width: 200, height: 30 }),
    };
    return n;
  };
  return { doc: { createElement: make }, root: make('div') };
}

const ITEMS = [
  { id: 'm0', type: 'normal', label: 'Online', enabled: false },
  { type: 'separator' },
  { id: 'm2', type: 'normal', label: 'Teleport', enabled: true },
  { id: 'm3', type: 'submenu', label: 'Size', enabled: true, submenu: [{ id: 'm3.0', type: 'radio', label: 'Small', checked: true, enabled: true }] },
];

function open() {
  const { doc, root } = fakeDom();
  const picked = [];
  let closed = 0;
  const menu = new Menu({ doc, root, onPick: (id) => picked.push(id), onClose: () => { closed++; } });
  menu.show(ITEMS, { x: 300, y: 300 }, area);
  return { menu, picked, closed: () => closed };
}

test('open, she takes the whole screen\'s clicks; closed, none', () => {
  const { menu } = open();
  assert.equal(menu.open, true);
  assert.deepEqual(menu.rects(), [[0, 0, 2560, 1440]]);
  menu.key('Escape');
  assert.equal(menu.open, false);
  assert.deepEqual(menu.rects(), []);
});

test('Down, Down, Return picks Teleport and closes without a second word to main', () => {
  const { menu, picked, closed } = open();
  menu.key('Down');
  menu.key('Return');
  assert.deepEqual(picked, ['m2']);
  assert.equal(menu.open, false);
  assert.equal(closed(), 0);
});

test('Right opens a submenu, Escape closes only it, Escape again closes the menu', () => {
  const { menu, picked, closed } = open();
  menu.key('Down'); menu.key('Down'); // Size
  menu.key('Right');
  assert.equal(menu.levels.length, 2);
  menu.key('Return');
  assert.deepEqual(picked, ['m3.0']);
  const again = open();
  again.menu.key('Down'); again.menu.key('Down'); again.menu.key('Right');
  again.menu.key('Escape');
  assert.equal(again.menu.levels.length, 1);
  assert.equal(again.menu.open, true);
  again.menu.key('Escape');
  assert.equal(again.closed(), 1);
  assert.equal(closed(), 0);
});

test('a click on the layer outside her menu closes it', () => {
  const { menu, closed } = open();
  menu.layer.listeners.pointerdown({ target: menu.layer });
  assert.equal(menu.open, false);
  assert.equal(closed(), 1);
});
