import test from 'node:test';
import assert from 'node:assert/strict';
import { Viewport, contentBox } from '../src/renderer/js/viewport.js';

const inside = (inner, outer) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];

test('contentBox is the union of the rects plus a margin', () => {
  assert.deepEqual(contentBox([[100, 100, 50, 50], [300, 120, 20, 20]], 10), [90, 90, 240, 70]);
  assert.equal(contentBox([], 10), null);
});

test('the first request covers the content with slack', () => {
  const v = new Viewport({ slack: 80 });
  const want = v.want([1000, 800, 200, 300], 0);
  assert.deepEqual(want, [920, 720, 360, 460]);
});

test('no new request while the content stays inside', () => {
  const v = new Viewport({ slack: 80 });
  v.applied(v.want([1000, 800, 200, 300], 0));
  assert.equal(v.want([1030, 790, 200, 300], 16), null);
  assert.equal(v.want([960, 760, 200, 300], 32), null);
});

test('content crossing an edge asks for a new viewport that contains it', () => {
  const v = new Viewport({ slack: 80 });
  v.applied(v.want([1000, 800, 200, 300], 0));
  const content = [1200, 800, 200, 300];
  const next = v.want(content, 16);
  assert.ok(next);
  assert.ok(inside(content, next));
});

test('a viewport much bigger than needed shrinks, but only after a pause', () => {
  const v = new Viewport({ slack: 80, shrinkAfterMs: 700 });
  v.applied(v.want([0, 0, 1200, 900], 0)); // a big effect
  assert.equal(v.want([500, 400, 200, 300], 100), null);
  assert.equal(v.want([500, 400, 200, 300], 600), null);
  const small = v.want([500, 400, 200, 300], 900);
  assert.deepEqual(small, [420, 320, 360, 460]);
});

test('the request is never smaller than the minimum size, and is whole pixels', () => {
  const v = new Viewport({ slack: 0, min: 64 });
  assert.deepEqual(v.want([10.4, 10.6, 5, 5], 0), [10, 10, 64, 64]);
});

test('until the main process applies a request, it is not asked again', () => {
  const v = new Viewport({ slack: 80 });
  assert.ok(v.want([1000, 800, 200, 300], 0));
  assert.equal(v.want([1000, 800, 200, 300], 16), null, 'pending');
  v.applied([920, 720, 360, 460]);
  assert.equal(v.want([1000, 800, 200, 300], 32), null);
});
