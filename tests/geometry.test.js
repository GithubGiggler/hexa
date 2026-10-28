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

test('toWindowRects shifts world rects into the window and clips them', () => {
  const { toWindowRects } = require('../src/main/geometry');
  const vp = [1000, 500, 400, 300];
  assert.deepEqual(toWindowRects([[1100, 600, 50, 50]], vp), [[100, 100, 50, 50]]);
  assert.deepEqual(toWindowRects([[950, 480, 100, 100]], vp), [[0, 0, 50, 80]]);
  assert.deepEqual(toWindowRects([[0, 0, 10, 10]], vp), []);
});
