'use strict';

// The overlay: one transparent, always-on-top window covering the display Hexa is on.
// Clicks only land on the rectangles the renderer reports (her body, her panel); everywhere else
// they go to whatever is underneath. On X11 that's the window's input shape, routed by the X
// server; without it, the pointer is polled and click-through toggled.

const { BrowserWindow, screen } = require('electron');
const { toPhysical, mergeRects, chooseDisplay, rectsEqual } = require('./geometry');

const HIT_EVERY_MS = 33;    // input shape updates, at most ~30 a second
const POLL_EVERY_MS = 33;   // pointer polling when there's no input shape
const POINTER_EVERY_MS = 100;

const inside = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);

function createOverlay({ preload, url, x11, displayId = null }) {
  const pick = (id) => chooseDisplay(screen.getAllDisplays(), id, screen.getPrimaryDisplay().id);
  let wanted = displayId;
  let display = pick(wanted);

  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    type: 'toolbar',
    backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // her page stays her page: no navigating away, no new windows (her preload's powers are for it alone)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadURL(url);

  const xid = win.getNativeWindowHandle().readUInt32LE(0);
  const mode = x11?.hasShape ? 'shape' : 'poll';
  let dipRects = [];      // what the renderer says is clickable, in overlay DIP
  let applied = null;     // the input shape last sent to the X server
  let hitTimer = null;
  const timers = [];

  const area = () => {
    const b = display.bounds;
    const wa = display.workArea;
    return { x: wa.x - b.x, y: wa.y - b.y, w: wa.width, h: wa.height, scale: display.scaleFactor };
  };
  const sendArea = () => !win.isDestroyed() && win.webContents.send('overlay:area', area());

  function applyShape() {
    hitTimer = null;
    if (win.isDestroyed()) return;
    const phys = toPhysical(mergeRects(dipRects, 16), display.scaleFactor);
    if (rectsEqual(phys, applied)) return;
    try {
      x11.setInputRects(xid, phys);
      applied = phys;
    } catch (err) {
      console.error('[hexa] input shape:', err.message);
    }
  }

  function setHitRects(rects) {
    dipRects = Array.isArray(rects) ? rects.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)) : [];
    if (mode === 'shape' && !hitTimer) hitTimer = setTimeout(applyShape, HIT_EVERY_MS);
  }

  const relativePointer = () => {
    const p = screen.getCursorScreenPoint();
    const b = display.bounds;
    return { x: p.x - b.x, y: p.y - b.y };
  };

  if (mode === 'shape') {
    x11.setInputRects(xid, []); // nothing is clickable until the renderer reports her
    applied = [];
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
    let catching = false;
    timers.push(setInterval(() => {
      const p = relativePointer();
      const now = inside(dipRects, p.x, p.y);
      if (now === catching || win.isDestroyed()) return;
      catching = now;
      win.setIgnoreMouseEvents(!now, { forward: true });
    }, POLL_EVERY_MS));
  }

  // where the pointer is, for her to look at it or shy away from it
  timers.push(setInterval(() => {
    if (win.isDestroyed()) return;
    const p = relativePointer();
    win.webContents.send('pointer', { ...p, inside: inside(dipRects, p.x, p.y) });
  }, POINTER_EVERY_MS));

  // a monitor plugged in, unplugged or resized: fit the display she's meant to be on
  function refit(id = wanted) {
    wanted = id;
    display = pick(wanted);
    if (win.isDestroyed()) return display;
    win.setBounds(display.bounds);
    applied = null; // the scale may have changed: send the shape again
    if (mode === 'shape') applyShape();
    sendArea();
    return display;
  }
  const onDisplays = () => refit();
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  win.webContents.on('did-finish-load', sendArea);
  win.once('ready-to-show', () => {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  });

  return {
    win,
    xid,
    get display() { return display; },
    mode,
    setHitRects,
    refit,
    area,
    destroy() {
      for (const t of timers) clearInterval(t);
      if (hitTimer) clearTimeout(hitTimer);
      screen.off('display-added', onDisplays);
      screen.off('display-removed', onDisplays);
      screen.off('display-metrics-changed', onDisplays);
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

module.exports = { createOverlay };
