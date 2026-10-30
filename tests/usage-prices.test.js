'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPrices, priceFor, costOf, costOfModels, canonical, BUILT_IN } = require('../src/main/usage/prices');

const quiet = { warn: () => {} };
const noFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-prices-')), 'prices.json');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('the built-in table is dated and covers the current models', () => {
  assert.match(BUILT_IN.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(BUILT_IN.about, /estimate/);
  const t = loadPrices({ file: noFile() });
  for (const id of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5']) assert.ok(t.models[id], id);
  for (const p of Object.values(t.models)) for (const k of ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead']) assert.equal(typeof p[k], 'number');
  assert.equal(t.custom, false);
});

test('model ids from every platform find their prices', () => {
  assert.equal(canonical('claude-opus-4-5-20251101'), 'claude-opus-4-5');
  assert.equal(canonical('us.anthropic.claude-opus-4-5-20251101-v1:0'), 'claude-opus-4-5');
  assert.equal(canonical('claude-opus-4-5@20251101'), 'claude-opus-4-5');
  assert.equal(canonical('claude-opus-5-5[1m]'), 'claude-opus-5-5');
  const t = loadPrices({ file: noFile() });
  assert.equal(priceFor(t, 'claude-haiku-4-5-20251001').input, 1);
  assert.equal(priceFor(t, 'claude-opus-4-20250514').input, 15);
});

test('an unknown model of a known family gets that family\'s prices; anything else none', () => {
  const t = loadPrices({ file: noFile() });
  assert.equal(priceFor(t, 'claude-opus-9-1'), t.models['claude-opus-5-5']);
  assert.equal(priceFor(t, 'claude-sonnet-7'), t.models['claude-sonnet-5-5']);
  assert.equal(priceFor(t, 'claude-haiku-6'), t.models['claude-haiku-5-5']);
  assert.equal(priceFor(t, 'gpt-5'), null);
  assert.equal(priceFor(t, 'unknown'), null);
  assert.equal(priceFor(t, 'claude-octopus-1'), null, 'a family is a whole word');
  assert.equal(costOf(t, 'unknown', { input: 1e6 }), null);
});

test('cost: each kind of token at its price, one-hour writes at theirs', () => {
  const t = loadPrices({ file: noFile() });
  // Opus 5.5: $4 in, $20 out, $5 5m write, $8 1h write, $0.20 read
  const usd = costOf(t, 'claude-opus-5-5', { input: 1e6, output: 1e6, cacheWrite: 3e6, cacheWrite1h: 1e6, cacheRead: 10e6 });
  close(usd, 4 + 20 + 2 * 5 + 8 + 10 * 0.2);
});

test('cost: messages with long prompts pay the long prices where a model has them', () => {
  const t = loadPrices({ file: noFile() });
  const usage = { input: 2e6, output: 1e6, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, long: { input: 1e6, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 } };
  close(costOf(t, 'claude-haiku-5-5', usage), 0.1 + 0.5 + 0.5);
  // no long prices: it's all at the usual ones
  close(costOf(t, 'claude-opus-5-5', usage), 2 * 4 + 20);
});

test('costOfModels sums the priced and lists the rest', () => {
  const t = loadPrices({ file: noFile() });
  const c = costOfModels(t, { 'claude-sonnet-5-5': { input: 1e6 }, mystery: { input: 5 } });
  close(c.usd, 2);
  assert.deepEqual(c.unpriced, ['mystery']);
  assert.equal(c.estimate, true);
});

test('your prices.json replaces and adds models, and missing cache prices follow the input price', () => {
  const file = noFile();
  fs.writeFileSync(file, JSON.stringify({
    updated: '2027-01-01',
    models: { 'claude-opus-5-5': { input: 1, output: 2 }, 'My-Model': { input: 10, output: 20, cacheRead: 0 }, broken: { output: 1 } },
    families: { gizmo: 'my-model' },
  }));
  const warned = [];
  const t = loadPrices({ file, log: { warn: (m) => warned.push(m) } });
  assert.equal(t.custom, true);
  assert.equal(t.updated, '2027-01-01');
  assert.deepEqual(t.models['claude-opus-5-5'], { input: 1, output: 2, cacheWrite: 1.25, cacheWrite1h: 2, cacheRead: 0.1 });
  assert.equal(t.models['my-model'].cacheRead, 0);
  assert.equal(t.models.broken, undefined);
  assert.equal(warned.length, 1);
  assert.equal(priceFor(t, 'gizmo-2'), t.models['my-model']);
  assert.ok(t.models['claude-sonnet-5-5'], 'the rest of the built-in table stays');
});

test('a prices.json that is not JSON is ignored with a warning', () => {
  const file = noFile();
  fs.writeFileSync(file, '{nope');
  const warned = [];
  const t = loadPrices({ file, log: { warn: (m) => warned.push(m) } });
  assert.equal(t.custom, false);
  assert.equal(t.models['claude-opus-5-5'].input, 4);
  assert.equal(warned.length, 1);
  assert.ok(loadPrices({ file: noFile(), log: quiet }));
});
