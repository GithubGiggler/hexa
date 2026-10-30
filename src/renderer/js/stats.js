// The stats window: her records by day, project and model, with totals and export. Built from
// numbers the main process sends (window.stats); every bit of text goes in through textContent.
// The helpers at the top have no DOM, so tests can import them.

import { duration, plural } from './util.js';

export const RANGES = [['today', 'Day'], ['week', 'Week'], ['month', 'Month']];

// 1,284 -> 1.3K; 12,900 -> 13K; 4,200,000 -> 4.2M
export function compact(n) {
  const v = Math.max(0, Number(n) || 0);
  for (const [size, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (v >= size * 0.9995) {
      const x = v / size;
      return `${x < 9.95 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)}${unit}`;
    }
  }
  return String(Math.round(v));
}

export function usd(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  if (v >= 1000) return `$${compact(v)}`;
  return `$${v.toFixed(2)}`;
}

// what a bar chart shows, and how its numbers read
export const METRICS = {
  tokens: { label: 'Tokens', of: (d) => d.totalTokens, format: compact },
  time: { label: 'Time', of: (d) => d.activeMs, format: (ms) => (ms ? duration(ms) : '0') },
  tasks: { label: 'Tasks', of: (d) => d.tasks, format: (n) => String(n) },
};

// A round top for an axis: 1, 2 or 5 times a power of ten, at least v.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
}

const parseDate = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const dayName = (key) => parseDate(key).toLocaleDateString('en', { weekday: 'short' });
// 29 Oct: day first, and the same three-letter months everywhere
export const shortDate = (key) => {
  const d = parseDate(key);
  return `${d.getDate()} ${d.toLocaleDateString('en', { month: 'short' })}`;
};
export const longDate = (key) => `${shortDate(key)} ${parseDate(key).getFullYear()}`;

export function rangeText(view) {
  if (!view) return '';
  return view.from === view.to ? longDate(view.to) : `${shortDate(view.from)} to ${longDate(view.to)}`;
}

// Columns for days in a chart width × height: bars at most 24 px wide with at least 2 px of air
// between them, grown from the baseline. Zero days get no bar.
export function columns(values, { width, height }) {
  const n = values.length;
  if (!n) return { max: 1, cols: [] };
  const max = niceMax(Math.max(...values));
  const slot = width / n;
  const w = Math.max(2, Math.min(24, slot - 2));
  const cols = values.map((v, i) => {
    const h = v > 0 ? Math.max(2, (v / max) * height) : 0;
    return { x: i * slot, slot, barX: i * slot + (slot - w) / 2, w, h, y: height - h, value: v };
  });
  return { max, cols };
}

// A bar with a 4 px round top and a square foot.
export function barPath({ barX: x, y, w, h }) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Day labels under the bars: every weekday for a week, every fifth day back from today for a month.
export function tickLabels(dates) {
  if (dates.length <= 7) return dates.map(dayName);
  return dates.map((key, i) => ((dates.length - 1 - i) % 5 === 0 ? String(parseDate(key).getDate()) : ''));
}

// The largest few of { name: value }, the rest folded into "Other".
export function topRows(obj, keep = 6) {
  const rows = Object.entries(obj || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (rows.length <= keep) return rows;
  const rest = rows.slice(keep - 1).reduce((a, [, v]) => a + v, 0);
  return [...rows.slice(0, keep - 1), ['Other', rest]];
}

export function totals(summary) {
  return [
    ['Tasks', String(summary.tasks)],
    ['Actions', compact(summary.actions)],
    ['Files changed', compact(summary.filesChanged)],
    ['Errors', compact(summary.errors)],
    ['Tokens', compact(summary.totalTokens)],
    ['Est. cost', usd(summary.cost?.usd)],
  ];
}

export function costNote(summary) {
  const p = summary.prices || {};
  const parts = [`Cost is an estimate at Anthropic API list prices${p.updated ? ` (as of ${p.updated})` : ''}${p.custom ? ', with your prices.json' : ''}. On a subscription, it's what the same use would cost on the API.`];
  const unpriced = summary.cost?.unpriced || [];
  if (unpriced.length) parts.push(`No price for ${unpriced.join(', ')}.`);
  return parts.join(' ');
}

export function extras(summary) {
  const out = [];
  const lm = summary.longestMission;
  if (lm) out.push(`Longest mission: ${duration(lm.ms)} in ${lm.project}${summary.days > 1 && lm.date ? ` (${shortDate(lm.date)})` : ''}`);
  out.push(`${summary.prompts} ${plural(summary.prompts, ['prompt', 'prompts'])}`);
  out.push(`${summary.approvals.total} ${plural(summary.approvals.total, ['approval', 'approvals'])} (${summary.approvals.viaHexa} through Hexa)`);
  if (summary.activeMs) out.push(`${duration(summary.activeMs)} with Claude at work`);
  return out;
}

// ---- the DOM ----

const SVG = 'http://www.w3.org/2000/svg';

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const CHART = { width: 700, height: 120, left: 44, bottom: 22, top: 16 };

function barChart(doc, days, metric) {
  const m = METRICS[metric];
  const values = days.map(m.of);
  const plotW = CHART.width - CHART.left;
  const { max, cols } = columns(values, { width: plotW, height: CHART.height });
  const root = svg(doc, 'svg', {
    class: 'st-chart',
    viewBox: `0 0 ${CHART.width} ${CHART.top + CHART.height + CHART.bottom}`,
    role: 'img',
    'aria-label': `${m.label} by day`,
  });
  const plot = svg(doc, 'g', { transform: `translate(${CHART.left},${CHART.top})` });
  root.append(plot);

  // three hairlines: 0, half, top
  for (const f of [0, 0.5, 1]) {
    const y = CHART.height - f * CHART.height;
    plot.append(svg(doc, 'line', { class: 'st-grid', x1: 0, x2: plotW, y1: y, y2: y }));
    const label = svg(doc, 'text', { class: 'st-axis', x: -8, y: y + 4, 'text-anchor': 'end' });
    label.textContent = m.format(max * f);
    plot.append(label);
  }

  const ticks = tickLabels(days.map((d) => d.date));
  const peak = values.indexOf(Math.max(...values));
  cols.forEach((c, i) => {
    const g = svg(doc, 'g', { class: 'st-col' });
    const title = svg(doc, 'title');
    title.textContent = `${longDate(days[i].date)}: ${m.format(c.value)}`;
    g.append(title);
    // the whole column answers the pointer, not just the bar
    g.append(svg(doc, 'rect', { class: 'st-hit', x: c.x, y: 0, width: c.slot, height: CHART.height }));
    if (c.h > 0) g.append(svg(doc, 'path', { class: 'st-bar', d: barPath(c) }));
    if (ticks[i]) {
      const t = svg(doc, 'text', { class: 'st-axis', x: c.x + c.slot / 2, y: CHART.height + 16, 'text-anchor': 'middle' });
      t.textContent = ticks[i];
      g.append(t);
    }
    // only the busiest day carries its number
    if (i === peak && c.value > 0) {
      const v = svg(doc, 'text', { class: 'st-value', x: c.x + c.slot / 2, y: c.y - 5, 'text-anchor': 'middle' });
      v.textContent = m.format(c.value);
      g.append(v);
    }
    plot.append(g);
  });
  return root;
}

// Name, a bar of its share of the largest, its value (and a quieter line under it).
function barList(doc, rows, format, detail = () => '') {
  const list = el(doc, 'ul', 'st-list');
  const top = rows[0]?.[1] || 1;
  for (const [name, value] of rows) {
    const li = el(doc, 'li', 'st-row');
    const head = el(doc, 'div', 'st-row-head');
    head.append(el(doc, 'span', 'st-row-name', name), el(doc, 'span', 'st-row-value', format(value)));
    const track = el(doc, 'div', 'st-track');
    const fill = el(doc, 'div', 'st-fill');
    fill.style.width = `${Math.max(1, (value / top) * 100)}%`;
    track.append(fill);
    li.append(head, track);
    const more = detail(name);
    if (more) li.append(el(doc, 'div', 'st-row-detail', more));
    list.append(li);
  }
  return list;
}

function modelDetail(summary) {
  return (name) => {
    const u = summary.tokens?.[name];
    if (!u) return '';
    const cost = summary.cost?.byModel?.[name];
    const parts = [`in ${compact(u.input)}`, `out ${compact(u.output)}`, `cache ${compact(u.cacheWrite + u.cacheRead)}`];
    if (cost !== undefined) parts.push(`est. ${usd(cost)}`);
    return parts.join(' · ');
  };
}

function card(doc, title, body) {
  const section = el(doc, 'section', 'st-card');
  const head = el(doc, 'div', 'st-card-head');
  head.append(el(doc, 'h2', 'st-card-title', title));
  section.append(head, body);
  return section;
}

const empty = (doc, text) => el(doc, 'p', 'st-empty', text);

export function mount(root, api, { win = globalThis } = {}) {
  const doc = root.ownerDocument;
  const state = { range: 'today', metric: 'tokens', view: null };

  const header = el(doc, 'header', 'st-head');
  const title = el(doc, 'h1', 'st-title');
  title.append(el(doc, 'span', 'st-mark', 'HEXA'), el(doc, 'span', 'st-sub', ' // usage'));
  const tabs = el(doc, 'div', 'st-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Range');
  const tabButtons = RANGES.map(([range, label]) => {
    const b = el(doc, 'button', 'st-tab', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => load(range));
    tabs.append(b);
    return [range, b];
  });
  header.append(title, tabs);

  const rangeLine = el(doc, 'p', 'st-range');
  const main = el(doc, 'main', 'st-main');
  const foot = el(doc, 'footer', 'st-foot');
  const extraLine = el(doc, 'p', 'st-extra');
  const note = el(doc, 'p', 'st-note');
  const actions = el(doc, 'div', 'st-export');
  const saved = el(doc, 'span', 'st-saved');
  saved.setAttribute('role', 'status');
  for (const [format, label] of [['csv', 'Export CSV'], ['json', 'Export JSON']]) {
    const b = el(doc, 'button', 'st-button', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      saved.textContent = '';
      const r = await Promise.resolve().then(() => api.export(format, state.range)).catch(() => ({ ok: false }));
      if (r?.ok) saved.textContent = `Saved ${r.file}`;
      else if (!r?.canceled) saved.textContent = 'Could not save the file';
    });
    actions.append(b);
  }
  actions.append(saved);
  foot.append(extraLine, note, actions);
  root.replaceChildren(header, rangeLine, main, foot);

  function render() {
    const view = state.view;
    for (const [range, b] of tabButtons) b.setAttribute('aria-selected', String(range === state.range));
    if (!view) {
      main.replaceChildren(empty(doc, 'Her records could not be read.'));
      return;
    }
    const s = view.summary;
    rangeLine.textContent = rangeText(view);

    const tiles = el(doc, 'section', 'st-totals');
    tiles.setAttribute('aria-label', 'Totals');
    for (const [label, value] of totals(s)) {
      const tile = el(doc, 'div', 'st-tile');
      tile.append(el(doc, 'span', 'st-tile-label', label), el(doc, 'span', 'st-tile-value', value));
      tiles.append(tile);
    }
    const parts = [tiles];

    // one bar isn't a chart: the day view skips it
    if (view.days.length > 1) {
      const switcher = el(doc, 'div', 'st-metric');
      switcher.setAttribute('role', 'group');
      switcher.setAttribute('aria-label', 'Show');
      for (const [key, m] of Object.entries(METRICS)) {
        const b = el(doc, 'button', 'st-chip', m.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(key === state.metric));
        b.addEventListener('click', () => {
          state.metric = key;
          render();
        });
        switcher.append(b);
      }
      const byDay = card(doc, 'By day', barChart(doc, view.days, state.metric));
      byDay.querySelector('.st-card-head').append(switcher);
      parts.push(byDay);
    }

    const cols = el(doc, 'div', 'st-cols');
    const projects = topRows(s.timeByProject);
    cols.append(card(doc, 'Time by project', projects.length
      ? barList(doc, projects, (ms) => duration(ms))
      : empty(doc, 'No time with Claude at work yet.')));
    const models = topRows(Object.fromEntries(Object.entries(s.tokens || {}).map(([k, u]) => [k, u.input + u.output + u.cacheWrite + u.cacheRead])));
    cols.append(card(doc, 'Tokens by model', models.length
      ? barList(doc, models, compact, modelDetail(s))
      : empty(doc, 'No tokens counted yet.')));
    parts.push(cols);

    main.replaceChildren(...parts);
    extraLine.textContent = extras(s).join('  ·  ');
    note.textContent = costNote(s);
  }

  async function load(range = state.range) {
    state.range = range;
    try {
      state.view = await api.get(range);
    } catch {
      state.view = null;
    }
    render();
  }

  // back in front: the numbers may have moved on
  win.addEventListener?.('focus', () => load());
  return load('today');
}
