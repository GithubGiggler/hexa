'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory } = require('../src/main/usage/history');
const { loadPrices } = require('../src/main/usage/prices');
const { toCsv, toJson, statsView, statsCli, exportName } = require('../src/main/usage/report');

const T = new Date(2026, 9, 29, 12, 0, 0).getTime();
const quiet = { warn: () => {}, error: () => {} };

async function history() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-report-'));
  let t = T;
  const h = createHistory({ dir: path.join(root, 'history'), prices: loadPrices({ file: '/nonexistent' }), now: () => t, log: quiet });
  const file = path.join(root, 's.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', timestamp: new Date(T).toISOString(), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000 } } }) + '\n');
  const ev = (name, extra) => h.record({ hook_event_name: name, session_id: 's', cwd: '/w/=SUM(A1)', ...extra });
  ev('UserPromptSubmit');
  ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/w/a.js' } });
  t += 90 * 1000;
  await ev('Stop', { transcript_path: file });
  h.flush();
  return h;
}

test('statsView: a tab\'s range added up, and each day in it', async () => {
  const h = await history();
  const v = statsView(h, 'week', T);
  assert.equal(v.range, 'week');
  assert.equal(v.from, '2026-10-23');
  assert.equal(v.to, '2026-10-29');
  assert.equal(v.days.length, 7);
  assert.equal(v.summary.tasks, 1);
  assert.equal(statsView(h, 'year', T), null);
  assert.equal(statsView(h, 'today', T).days.length, 1);
});

test('CSV: a header and a row per day, numbers only', async () => {
  const h = await history();
  const csv = toCsv(statsView(h, 'week', T).days);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 8);
  assert.equal(lines[0], 'date,tasks,prompts,actions,files_changed,errors,approvals,approvals_via_hexa,active_minutes,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,estimated_cost_usd');
  assert.equal(lines[7], '2026-10-29,1,1,1,1,0,0,0,1.5,100,50,20,1000,1170,0.0017');
  assert.equal(lines[1], '2026-10-23,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0000');
  assert.ok(!csv.includes('SUM'), 'project names are not in the CSV');
});

test('JSON: everything, marked as an estimate', async () => {
  const h = await history();
  const data = JSON.parse(toJson(statsView(h, 'today', T), T));
  assert.equal(data.app, 'hexa');
  assert.equal(data.costIsEstimate, true);
  assert.equal(data.exported, new Date(T).toISOString());
  assert.equal(data.summary.tokens['claude-opus-5-5'].input, 100);
  assert.equal(data.days.length, 1);
  assert.deepEqual(data.summary.timeByProject, { '=SUM(A1)': 90000 });
});

test('/cli/stats: today by default, week or month, anything else refused', async () => {
  const h = await history();
  const today = statsCli(h, {}, T);
  assert.equal(today.status, undefined);
  assert.equal(today.body.ok, true);
  assert.equal(today.body.range, 'today');
  assert.equal(today.body.tasks, 1);
  assert.equal(today.body.cost.estimate, true);
  assert.equal(statsCli(h, { range: 'month' }, T).body.days, 30);
  const bad = statsCli(h, { range: '../../etc' }, T);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
});

test('export file names say what they cover', () => {
  assert.equal(exportName({ from: '2026-10-29', to: '2026-10-29' }, 'csv'), 'hexa-usage-2026-10-29.csv');
  assert.equal(exportName({ from: '2026-10-23', to: '2026-10-29' }, 'json'), 'hexa-usage-2026-10-23-to-2026-10-29.json');
});
