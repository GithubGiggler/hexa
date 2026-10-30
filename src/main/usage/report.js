'use strict';

// Her records shaped for the stats window, for `hexa stats` (/cli/stats), and as files to keep
// (CSV or JSON). Pure: a history in, plain data or text out.

const { rangeFor } = require('./history');

const RANGES = ['today', 'week', 'month'];

const sumOf = (d, k) => Object.values(d.tokens || {}).reduce((a, u) => a + (u[k] || 0), 0);

// One row per day. Only dates and numbers, so nothing in it can be read as a spreadsheet formula.
const COLUMNS = [
  ['date', (d) => d.date],
  ['tasks', (d) => d.tasks],
  ['prompts', (d) => d.prompts],
  ['actions', (d) => d.actions],
  ['files_changed', (d) => d.filesChanged],
  ['errors', (d) => d.errors],
  ['approvals', (d) => d.approvals.total],
  ['approvals_via_hexa', (d) => d.approvals.viaHexa],
  ['active_minutes', (d) => Math.round(d.activeMs / 6000) / 10],
  ['input_tokens', (d) => sumOf(d, 'input')],
  ['output_tokens', (d) => sumOf(d, 'output')],
  ['cache_write_tokens', (d) => sumOf(d, 'cacheWrite')],
  ['cache_read_tokens', (d) => sumOf(d, 'cacheRead')],
  ['total_tokens', (d) => d.totalTokens],
  ['estimated_cost_usd', (d) => d.cost.usd.toFixed(4)],
];

function toCsv(days) {
  const rows = [COLUMNS.map(([name]) => name).join(',')];
  for (const d of days) rows.push(COLUMNS.map(([, value]) => value(d)).join(','));
  return rows.join('\n') + '\n';
}

function toJson(view, t = Date.now()) {
  return JSON.stringify({
    app: 'hexa',
    kind: 'usage',
    exported: new Date(t).toISOString(),
    range: view.range,
    from: view.from,
    to: view.to,
    costIsEstimate: true,
    summary: view.summary,
    days: view.days,
  }, null, 2) + '\n';
}

// What the stats window shows for one of its tabs: the range added up, and each day in it.
function statsView(history, name, t = Date.now()) {
  if (!RANGES.includes(name)) return null;
  const range = rangeFor(name, t);
  return { range: name, ...range, summary: history.summary(range), days: history.days(range) };
}

// GET /cli/stats?range=today|week|month
function statsCli(history, query = {}, t = Date.now()) {
  const name = query?.range || 'today';
  if (!RANGES.includes(name)) return { status: 400, body: { ok: false, error: `range must be one of: ${RANGES.join(', ')}` } };
  return { body: { ok: true, range: name, ...history.summary(rangeFor(name, t)) } };
}

const exportName = (view, format) => `hexa-usage-${view.from === view.to ? view.from : `${view.from}-to-${view.to}`}.${format}`;

module.exports = { toCsv, toJson, statsView, statsCli, exportName, RANGES, COLUMNS };
