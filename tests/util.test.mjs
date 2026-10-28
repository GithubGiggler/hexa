import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, fmt, clip, basename, duration, plural, rand } from '../src/renderer/js/util.js';

test('clip is surrogate-safe and marks the cut', () => {
  const s = clip('😀'.repeat(40), 11);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(s));
  assert.ok(s.endsWith('…'));
  assert.ok(s.length <= 11);
  assert.equal(clip('short', 10), 'short');
});

test('duration reads like a person would say it', () => {
  assert.equal(duration(45000), '45 s');
  assert.equal(duration(134000), '2m 14s');
  assert.equal(duration(3780000), '1h 03m');
  assert.equal(duration(0), '0 s');
});

test('fmt fills known keys and leaves unknown ones', () => {
  assert.equal(fmt('{n} in {project} {x}', { n: 3, project: 'p' }), '3 in p {x}');
});

test('basename, plural, pick, rand', () => {
  assert.equal(basename('/a/b/c.ts'), 'c.ts');
  assert.equal(basename('C:\\a\\d.ts'), 'd.ts');
  assert.equal(basename(''), '');
  assert.equal(plural(1, ['file', 'files']), 'file');
  assert.equal(plural(2, ['file', 'files']), 'files');
  assert.equal(pick(['a', 'b'], () => 0.99), 'b');
  assert.ok(rand(2, 3, () => 0.5) === 2.5);
});
