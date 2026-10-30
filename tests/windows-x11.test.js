'use strict';

// Talks to an X server and window manager: only with HEXA_TEST_X=1 (npm run test:x runs it on a
// hidden desktop, never your own screen). Opens a small real (managed) window for a couple of
// seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { connect } = require('../src/main/platform/linux/x11');
const { startX11Windows } = require('../src/main/platform/linux/windows-x11');

const X_SKIP = !(process.env.HEXA_TEST_X && process.env.DISPLAY) && 'needs HEXA_TEST_X=1 and an X display (npm run test:x)';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await wait(50);
  }
  return null;
}

test('the tracker sees a window appear, move and go', { skip: X_SKIP }, async () => {
  const x11 = await connect();
  assert.ok(x11, 'connected');
  // a second connection plays the app whose window we watch
  const other = await connect();
  const display = { bounds: { x: 0, y: 0, width: 100000, height: 100000 }, scaleFactor: 1 }; // every window counts
  let snap = null;
  const tracker = await startX11Windows({ x11, selfXid: 0, getDisplay: () => display, onUpdate: (s) => { snap = s; } });
  const { X, root } = other;
  const wid = X.AllocID();
  X.CreateWindow(wid, root, 200, 220, 240, 140, 0, 0, 1, 0, { backgroundPixel: 0x141a2e });
  X.ChangeProperty(0, wid, X.atoms.WM_NAME, X.atoms.STRING, 8, 'hexa-tracker-test');
  X.MapWindow(wid);
  try {
    const seen = await until(() => snap?.wins.find((w) => w.id === wid));
    assert.ok(seen, 'the new window is in a snapshot');
    assert.ok(seen.w >= 240 && seen.h >= 140, `its size (${seen.w}×${seen.h})`);

    const before = { x: seen.x, y: seen.y };
    X.ConfigureWindow(wid, { x: 420, y: 330 });
    const moved = await until(() => {
      const w = snap?.wins.find((v) => v.id === wid);
      return w && (w.x !== before.x || w.y !== before.y) ? w : null;
    });
    assert.ok(moved, 'the move is seen');

    X.DestroyWindow(wid);
    const gone = await until(() => snap && !snap.wins.some((w) => w.id === wid));
    assert.ok(gone, 'it leaves the snapshot when closed');
  } finally {
    tracker.stop();
    try { X.DestroyWindow(wid); } catch { /* already gone */ }
    await other.sync().catch(() => {});
    other.close();
    x11.close();
  }
});
