import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, usd, niceMax, columns, barPath, tickLabels, topRows, totals, costNote, extras, rangeText, METRICS } from '../src/renderer/js/stats.js';

test('compact numbers read short', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(999), '999');
  assert.equal(compact(1284), '1.3K');
  assert.equal(compact(12900), '13K');
  assert.equal(compact(999999), '1M');
  assert.equal(compact(4200000), '4.2M');
  assert.equal(compact(2.5e9), '2.5B');
  assert.equal(compact(-5), '0');
  assert.equal(compact(undefined), '0');
});

test('costs read as dollars, tiny ones as under a cent', () => {
  assert.equal(usd(0), '$0');
  assert.equal(usd(0.004), '<$0.01');
  assert.equal(usd(1.234), '$1.23');
  assert.equal(usd(12345), '$12K');
});

test('niceMax rounds an axis top up to 1, 2 or 5 times a power of ten', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(4100), 5000);
  assert.equal(niceMax(50000), 50000);
});

test('columns: thin bars from the baseline, air between them, no bar for an empty day', () => {
  const { max, cols } = columns([0, 5, 10], { width: 300, height: 100 });
  assert.equal(max, 10);
  assert.equal(cols[0].h, 0);
  assert.equal(cols[2].h, 100);
  assert.equal(cols[2].y, 0);
  assert.equal(cols[1].y + cols[1].h, 100, 'grown from the baseline');
  for (const c of cols) assert.ok(c.w <= 24);
  const month = columns(Array(30).fill(1), { width: 656, height: 100 }).cols;
  for (let i = 1; i < month.length; i++) assert.ok(month[i].barX - (month[i - 1].barX + month[i - 1].w) >= 2 - 1e-9, 'at least 2 px apart');
  assert.ok(columns([1, 0.001], { width: 100, height: 100 }).cols[1].h >= 2, 'a tiny day still shows');
});

test('a bar has a round top and a square foot', () => {
  const d = barPath({ barX: 10, y: 20, w: 20, h: 80 });
  assert.match(d, /^M10,100V24Q10,20 14,20H26Q30,20 30,24V100Z$/);
  assert.ok(!barPath({ barX: 0, y: 98, w: 20, h: 2 }).includes('NaN'));
});

test('day labels: weekdays for a week, every fifth day back from today for a month', () => {
  assert.deepEqual(tickLabels(['2026-10-26', '2026-10-27']), ['Mon', 'Tue']);
  const month = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(2026, 8, 30 + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const labels = tickLabels(month);
  assert.equal(labels.at(-1), '29');
  assert.equal(labels.at(-6), '24');
  assert.equal(labels.at(-2), '');
  assert.equal(labels.filter(Boolean).length, 6);
});

test('topRows keeps the largest and folds the rest into Other', () => {
  assert.deepEqual(topRows({ a: 1, b: 3, c: 0 }), [['b', 3], ['a', 1]]);
  const rows = topRows({ a: 9, b: 8, c: 7, d: 1, e: 1 }, 3);
  assert.deepEqual(rows, [['a', 9], ['b', 8], ['Other', 9]]);
  assert.deepEqual(topRows(undefined), []);
});

const summary = {
  from: '2026-10-23', to: '2026-10-29', days: 7, tasks: 3, prompts: 1, actions: 1284, errors: 2, filesChanged: 4,
  approvals: { total: 1, viaHexa: 0 }, activeMs: 3780000, totalTokens: 4200000,
  cost: { usd: 1.5, unpriced: ['mystery'] }, longestMission: { ms: 134000, project: 'capri', date: '2026-10-27' },
  prices: { updated: '2026-10-29', custom: true },
};

test('totals, the cost note and the extras', () => {
  assert.deepEqual(totals(summary), [['Tasks', '3'], ['Actions', '1.3K'], ['Files changed', '4'], ['Errors', '2'], ['Tokens', '4.2M'], ['Est. cost', '$1.50']]);
  const note = costNote(summary);
  assert.match(note, /estimate/);
  assert.match(note, /2026-10-29/);
  assert.match(note, /your prices\.json/);
  assert.match(note, /No price for mystery/);
  assert.deepEqual(extras(summary), ['Longest mission: 2m 14s in capri (27 Oct)', '1 prompt', '1 approval (0 through Hexa)', '1h 03m with Claude at work']);
  assert.deepEqual(extras({ ...summary, longestMission: null, prompts: 0, approvals: { total: 2, viaHexa: 0 }, activeMs: 0 }), ['0 prompts', '2 approvals (0 through Hexa)']);
});

test('the range line and the chart metrics', () => {
  assert.equal(rangeText({ from: '2026-10-29', to: '2026-10-29' }), '29 Oct 2026');
  assert.equal(rangeText({ from: '2026-10-23', to: '2026-10-29' }), '23 Oct to 29 Oct 2026');
  assert.equal(METRICS.time.format(0), '0');
  assert.equal(METRICS.time.format(134000), '2m 14s');
  assert.equal(METRICS.tokens.of({ totalTokens: 5 }), 5);
});
