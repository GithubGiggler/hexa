// Dev only: the stats window with made-up numbers, to look at it offscreen:
//   npx electron tools/capture.js src/renderer/dev/stats.html captures/stats.png 780 700
// ?range=week|month picks the tab shown first.

import { mount } from '../js/stats.js';

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const usage = (k) => ({ input: 900 * k, output: 2400 * k, cacheWrite: 30000 * k, cacheWrite1h: 0, cacheRead: 420000 * k, messages: 12 * k });

function day(date, i) {
  const k = [3, 0, 5, 8, 2, 11, 6, 9, 4, 7][i % 10];
  const tokens = k ? { 'claude-opus-5-5': usage(k), 'claude-haiku-5-5': usage(k / 6) } : {};
  const total = Object.values(tokens).reduce((a, u) => a + u.input + u.output + u.cacheWrite + u.cacheRead, 0);
  return {
    date, tasks: k, prompts: k + 2, actions: k * 14, errors: k % 3, filesChanged: k * 2,
    approvals: { total: k % 4, viaHexa: 0 }, timeByProject: k ? { capri: k * 9e5, api: k * 3e5 } : {}, activeMs: k * 12e5,
    tokens, totalTokens: total, cost: { usd: total * 4.2e-7, byModel: {}, unpriced: [], estimate: true },
    longestMission: k ? { ms: k * 4e5, project: 'capri' } : null,
  };
}

function view(range) {
  const n = { today: 1, week: 7, month: 30 }[range];
  const today = new Date();
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return day(key(d), i + 3);
  });
  const tokens = {};
  for (const d of days) {
    for (const [m, u] of Object.entries(d.tokens)) {
      const t = (tokens[m] ??= { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 0 });
      for (const f of Object.keys(t)) t[f] += u[f];
    }
  }
  const sum = (f) => days.reduce((a, d) => a + d[f], 0);
  const timeByProject = { capri: 0, api: 0, 'a-project-with-a-very-long-folder-name-indeed': 2.5e6, dotfiles: 4e5 };
  for (const d of days) for (const [p, ms] of Object.entries(d.timeByProject)) timeByProject[p] += ms;
  const summary = {
    from: days[0].date, to: days.at(-1).date, days: n,
    tasks: sum('tasks'), prompts: sum('prompts'), actions: sum('actions'), errors: sum('errors'), filesChanged: sum('filesChanged'),
    approvals: { total: 3, viaHexa: 0 }, timeByProject, activeMs: Object.values(timeByProject).reduce((a, b) => a + b, 0),
    tokens, totalTokens: sum('totalTokens'),
    cost: { usd: days.reduce((a, d) => a + d.cost.usd, 0), byModel: { 'claude-opus-5-5': 1.234, 'claude-haiku-5-5': 0.004 }, unpriced: [], estimate: true },
    longestMission: { ms: 4.4e6, project: 'capri', date: days.at(-1).date }, prices: { updated: '2026-10-29', custom: false },
  };
  return { range, from: summary.from, to: summary.to, summary, days };
}

const first = new URLSearchParams(location.search).get('range');
const api = { get: async (range) => view(range), export: async () => ({ ok: true, file: 'hexa-usage.csv' }) };
await mount(document.body, api);
const tab = { week: 2, month: 3 }[first];
if (tab) document.querySelector(`.st-tab:nth-child(${tab})`).click();
setTimeout(() => { document.title = 'ready'; }, 300); // tools/capture.js waits for this
