'use strict';

// Talks to an X server: only with HEXA_TEST_X=1 (npm run test:x runs it on a hidden desktop, never
// your own screen). Uses an invisible input-only window.
const test = require('node:test');
const assert = require('node:assert/strict');
const { connect } = require('../src/main/platform/linux/x11');

const X_SKIP = !(process.env.HEXA_TEST_X && process.env.DISPLAY) && 'needs HEXA_TEST_X=1 and an X display (npm run test:x)';

test('input shape decides who gets the click', { skip: X_SKIP }, async () => {
  const x11 = await connect();
  assert.ok(x11, 'connected to the X server');
  const { X, root } = x11;
  const wid = X.AllocID();
  // class 2 = InputOnly: takes part in event routing but draws nothing
  X.CreateWindow(wid, root, 50, 50, 400, 400, 0, 0, 2, 0, { overrideRedirect: true });
  X.MapWindow(wid);
  X.RaiseWindow(wid);
  try {
    await x11.sync();
    assert.equal(await x11.whoAt(100, 100), wid, 'before shaping, the window covers (100,100)');
    x11.setInputRects(wid, [[0, 0, 100, 100]]);
    await x11.sync();
    assert.equal(await x11.whoAt(100, 100), wid, 'inside the shape');
    assert.notEqual(await x11.whoAt(350, 350), wid, 'outside the shape, the click goes underneath');
  } finally {
    X.DestroyWindow(wid);
    await x11.sync();
    x11.close();
  }
});

test('connect() without a display gives null', async () => {
  const saved = process.env.DISPLAY;
  process.env.DISPLAY = ':987';
  try {
    assert.equal(await connect(), null);
  } finally {
    if (saved === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = saved;
  }
});

test('hasCompositor answers a boolean', { skip: X_SKIP }, async () => {
  const x11 = await connect();
  try {
    assert.equal(typeof await x11.hasCompositor(), 'boolean');
  } finally {
    x11.close();
  }
});
