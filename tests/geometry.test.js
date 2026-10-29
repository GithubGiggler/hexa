'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPhysical, mergeRects, chooseDisplay, rectsEqual } = require('../src/main/geometry');

test('toPhysical scales and rounds outward', () => {
  assert.deepEqual(toPhysical([[10.4, 10.6, 20.2, 5]], 1.5), [[15, 15, 31, 9]]);
  assert.deepEqual(toPhysical([[0, 0, 10, 10]], 1), [[0, 0, 10, 10]]);
});

test('toPhysical drops empty rects', () => {
  assert.deepEqual(toPhysical([[5, 5, 0, 10], [1, 1, 2, 2]], 1), [[1, 1, 2, 2]]);
});

test('mergeRects caps the count and still covers everything', () => {
  const rects = Array.from({ length: 40 }, (_, i) => [i * 30, (i % 3) * 30, 20, 20]);
  const merged = mergeRects(rects, 16);
  assert.ok(merged.length <= 16);
  for (const [x, y, w, h] of rects) {
    assert.ok(merged.some(([mx, my, mw, mh]) => mx <= x && my <= y && mx + mw >= x + w && my + mh >= y + h), `${x},${y} covered`);
  }
});

test('mergeRects unions overlapping rects', () => {
  assert.deepEqual(mergeRects([[0, 0, 10, 10], [5, 5, 10, 10]], 16), [[0, 0, 15, 15]]);
  assert.equal(mergeRects([[0, 0, 10, 10], [500, 500, 10, 10]], 16).length, 2);
});

test('chooseDisplay falls back to the primary, then the first', () => {
  const ds = [{ id: 1 }, { id: 2 }];
  assert.equal(chooseDisplay(ds, 1, 2).id, 1);
  assert.equal(chooseDisplay(ds, 9, 2).id, 2);
  assert.equal(chooseDisplay(ds, 9, 7).id, 1);
  assert.equal(chooseDisplay(ds, null, 2).id, 2);
});

test('rectsEqual', () => {
  assert.equal(rectsEqual([[1, 2, 3, 4]], [[1, 2, 3, 4]]), true);
  assert.equal(rectsEqual([[1, 2, 3, 4]], [[1, 2, 3, 5]]), false);
  assert.equal(rectsEqual([], []), true);
  assert.equal(rectsEqual(null, []), false);
});

test('sharedEdge: side by side, stacked with an offset, or apart', () => {
  const { sharedEdge } = require('../src/main/geometry');
  const big = { x: 0, y: 1080, width: 2560, height: 1440 };
  const top = { x: 238, y: 0, width: 1920, height: 1080 }; // the reference machine's layout
  assert.deepEqual(sharedEdge(big, top), { side: 'top', from: 238, to: 2158 });
  assert.deepEqual(sharedEdge(top, big), { side: 'bottom', from: 238, to: 2158 });
  const right = { x: 2560, y: 1080, width: 1920, height: 1080 };
  assert.deepEqual(sharedEdge(big, right), { side: 'right', from: 1080, to: 2160 });
  assert.equal(sharedEdge(top, right), null, 'only touching at a corner, or not at all');
});
