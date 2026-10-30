'use strict';

// The stats window and its preload, against a stand-in for Electron (no window ever opens).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const T = new Date(2026, 9, 29, 12, 0, 0).getTime();
const root = path.join(__dirname, '..');

function fakeElectron() {
  const handlers = new Map();
  const windows = [];
  const exposed = {};
  const invoked = [];
  const fake = {
    handlers,
    windows,
    exposed,
    invoked,
    saveAnswer: { canceled: true },
    app: { getPath: (name) => `/home/u/${name}` },
    dialog: { showSaveDialog: async (win, opts) => { fake.lastDialog = opts; return fake.saveAnswer; } },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { invoke: (...args) => { invoked.push(args); return Promise.resolve(null); } },
    BrowserWindow: class {
      constructor(opts) {
        this.opts = opts;
        this.events = {};
        this.calls = [];
        this.destroyed = false;
        this.webContents = {
          handlers: {},
          setWindowOpenHandler: (fn) => { this.webContents.openHandler = fn; },
          on: (name, fn) => { this.webContents.handlers[name] = fn; },
        };
        windows.push(this);
      }
      removeMenu() { this.calls.push('removeMenu'); }
      loadURL(url) { this.url = url; }
      once(name, fn) { this.events[name] = fn; }
      on(name, fn) { this.events[name] = fn; }
      isDestroyed() { return this.destroyed; }
      isMinimized() { return false; }
      show() { this.calls.push('show'); }
      focus() { this.calls.push('focus'); }
      destroy() { this.destroyed = true; this.events.closed?.(); }
    },
  };
  return fake;
}

// requires `file` with `electron` replaced by the stand-in
function withElectron(fake, file) {
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? fake : load.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(file)];
    return require(file);
  } finally {
    Module._load = load;
  }
}

function history() {
  const { createHistory } = require('../src/main/usage/history');
  const { loadPrices } = require('../src/main/usage/prices');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-stats-')), 'history');
  const h = createHistory({ dir, prices: loadPrices({ file: '/nonexistent' }), now: () => T, log: { warn() {}, error() {} } });
  h.record({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/w/capri' });
  h.record({ hook_event_name: 'Stop', session_id: 's', cwd: '/w/capri' });
  return h;
}

test('one small decorated, sandboxed window titled "Hexa: usage", on her own page', () => {
  const fake = fakeElectron();
  const { createStatsWindow } = withElectron(fake, '../src/main/usage/stats-window');
  const s = createStatsWindow({ history: history(), preload: '/app/src/stats-preload.js', icon: '/app/icon.png', now: () => T });
  assert.equal(fake.windows.length, 0, 'nothing opens until you ask');
  s.open();
  const [win] = fake.windows;
  assert.equal(win.opts.title, 'Hexa: usage');
  assert.equal(win.opts.show, false, 'shown once ready, not blank');
  assert.equal(win.opts.frame, undefined, 'decorated like any app window');
  assert.ok(win.opts.width <= 900 && win.opts.height <= 800);
  assert.deepEqual(win.opts.webPreferences, { preload: '/app/src/stats-preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false });
  assert.equal(win.url, 'hexa://app/src/renderer/stats.html');
  assert.ok(win.calls.includes('removeMenu'));
  assert.deepEqual(win.webContents.openHandler(), { action: 'deny' });
  let prevented = false;
  win.webContents.handlers['will-navigate']({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  win.events['ready-to-show']();
  assert.ok(win.calls.includes('show'));

  s.open();
  assert.equal(fake.windows.length, 1, 'a second open brings the same window to the front');
  assert.ok(win.calls.includes('focus'));
  win.destroy();
  s.open();
  assert.equal(fake.windows.length, 2, 'closed, it opens anew');
});

test('stats:get answers the stats window only, for the three ranges', async () => {
  const fake = fakeElectron();
  const { createStatsWindow } = withElectron(fake, '../src/main/usage/stats-window');
  const s = createStatsWindow({ history: history(), preload: '/p.js', now: () => T });
  const get = fake.handlers.get('stats:get');
  assert.equal(await get({ sender: {} }, 'today'), null, 'no window yet: nobody to answer');
  s.open();
  const sender = fake.windows[0].webContents;
  assert.equal(await get({ sender: {} }, 'today'), null, 'another page (her overlay) gets nothing');
  const view = await get({ sender }, 'week');
  assert.equal(view.range, 'week');
  assert.equal(view.days.length, 7);
  assert.equal(view.summary.tasks, 1);
  assert.equal(await get({ sender }, 'forever'), null);
});

test('stats:export saves CSV or JSON where you choose in the save dialog', async () => {
  const fake = fakeElectron();
  const { createStatsWindow } = withElectron(fake, '../src/main/usage/stats-window');
  const s = createStatsWindow({ history: history(), preload: '/p.js', now: () => T });
  s.open();
  const sender = fake.windows[0].webContents;
  const exp = fake.handlers.get('stats:export');
  await fake.handlers.get('stats:get')({ sender }, 'week');

  assert.deepEqual(await exp({ sender: {} }, 'csv'), { ok: false });
  assert.deepEqual(await exp({ sender }, 'xlsx'), { ok: false });
  assert.deepEqual(await exp({ sender }, 'csv'), { ok: false, canceled: true });
  assert.equal(fake.lastDialog.defaultPath, '/home/u/downloads/hexa-usage-2026-10-23-to-2026-10-29.csv', 'the tab on screen');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-export-'));
  fake.saveAnswer = { canceled: false, filePath: path.join(dir, 'u.csv') };
  assert.deepEqual(await exp({ sender }, 'csv'), { ok: true, file: 'u.csv' });
  const csv = fs.readFileSync(path.join(dir, 'u.csv'), 'utf8').trim().split('\n');
  assert.equal(csv.length, 8);
  assert.match(csv[0], /^date,tasks,/);

  fake.saveAnswer = { canceled: false, filePath: path.join(dir, 'u.json') };
  assert.deepEqual(await exp({ sender }, 'json', 'today'), { ok: true, file: 'u.json' });
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'u.json'), 'utf8'));
  assert.equal(json.range, 'today');
  assert.equal(json.costIsEstimate, true);
  assert.equal(json.summary.tasks, 1);
});

test('the stats preload exposes stats.get and stats.export, and nothing else', async () => {
  const fake = fakeElectron();
  withElectron(fake, '../src/stats-preload.js');
  assert.deepEqual(Object.keys(fake.exposed), ['stats']);
  assert.deepEqual(Object.keys(fake.exposed.stats).sort(), ['export', 'get']);
  await fake.exposed.stats.get('week');
  await fake.exposed.stats.export('csv');
  await fake.exposed.stats.export('json', 'month');
  assert.deepEqual(fake.invoked, [['stats:get', 'week'], ['stats:export', 'csv', undefined], ['stats:export', 'json', 'month']]);
});

test('the stats page has her strict CSP and no inline script or style', () => {
  const page = fs.readFileSync(path.join(root, 'src/renderer/stats.html'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(csp);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src hexa:;/);
  assert.match(csp, /style-src hexa:;/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.match(page, /<title>Hexa: usage<\/title>/);
  assert.ok(!/<script>(?!<)|<script(?![^>]*src=)[^>]*>/.test(page), 'scripts come from files');
  assert.ok(!/<style|style=/.test(page));
  const js = fs.readFileSync(path.join(root, 'src/renderer/js/stats.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), 'text only through textContent');
});
