'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parentChain, windowForChain } = require('../src/main/platform/linux/proc');

const root = path.join(__dirname, 'fixtures', 'proc');

test('parentChain walks up to init, even through names with spaces and parentheses', () => {
  assert.deepEqual(parentChain(4000, { root }), [4000, 3000, 2000, 1]);
});

test('a pid that is gone gives just itself', () => {
  assert.deepEqual(parentChain(9999, { root }), [9999]);
});

test('the walk is bounded', () => {
  assert.equal(parentChain(4000, { root, max: 2 }).length, 2);
});

test('windowForChain finds the closest ancestor with a window', () => {
  const wins = [{ id: 11, pid: 777 }, { id: 22, pid: 2000 }, { id: 33, pid: 1 }];
  assert.equal(windowForChain([4000, 3000, 2000, 1], wins).id, 22);
  assert.equal(windowForChain([4000, 3000], wins), null, 'no window in the chain');
});

test('the real /proc works for this test process', () => {
  const chain = parentChain(process.pid);
  assert.equal(chain[0], process.pid);
  assert.ok(chain.includes(process.ppid));
});
