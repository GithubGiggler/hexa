'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseKwinReport, SCRIPT_DIR } = require('../src/main/platform/linux/kwin');

const display = { x: 0, y: 0, width: 2560, height: 1440 };
const report = (wins, active = 'b') => JSON.stringify({ active, desktop: 'd1', wins });
const win = (id, extra = {}) => ({ id, x: 100, y: 100, w: 800, h: 600, pid: 42, cls: 'konsole', minimized: false, fullScreen: false, maximized: false, desktops: ['d1'], onAll: false, ...extra });

test('a KWin report becomes the same snapshot X11 gives: front first, in DIP, display-relative', () => {
  // KWin's stackingOrder is bottom to top, like X11's
  const snap = parseKwinReport(report([win('a'), win('b', { x: 300 })]), { display, scale: 1 });
  assert.equal(snap.fg, 'b');
  assert.deepEqual(snap.wins.map((w) => w.id), ['b', 'a']);
  assert.deepEqual(snap.wins[0], { id: 'b', x: 300, y: 100, w: 800, h: 600, max: false, pid: 42, cls: 'konsole' });
});

test('minimised windows and other desktops are left out; maximised and fullscreen are flagged', () => {
  const snap = parseKwinReport(report([
    win('min', { minimized: true }),
    win('other', { desktops: ['d2'] }),
    win('all', { desktops: [], onAll: true }),
    win('max', { maximized: true }),
    win('fs', { fullScreen: true }),
  ]), { display, scale: 1 });
  assert.deepEqual(snap.wins.map((w) => w.id), ['fs', 'max', 'all']);
  assert.equal(snap.wins.find((w) => w.id === 'max').max, true);
  assert.equal(snap.wins.find((w) => w.id === 'fs').max, true);
});

test('a broken report gives an empty snapshot', () => {
  assert.deepEqual(parseKwinReport('{nope', { display, scale: 1 }), { fg: 0, wins: [] });
});

test('the KWin script is valid JavaScript', () => {
  const r = spawnSync(process.execPath, ['--check', path.join(SCRIPT_DIR, 'contents', 'code', 'main.js')]);
  assert.equal(r.status, 0, String(r.stderr));
});
