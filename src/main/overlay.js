'use strict';

// Her window. Not a full-screen layer: a small transparent window about her size (plus her panel),
// moved and resized as she moves, growing only while an effect around her needs the room. The
// renderer computes everything in the display's coordinates and asks for the viewport it needs;
// this moves the window there and reports back what it applied.
// Clicks only land on the rectangles the renderer reports (her body, her panel); the rest of her
// window passes them to whatever is underneath. On X11 that's the window's input shape, routed
// by the X server; without it, the pointer is polled and click-through toggled.
// To the desktop she isn't an app: not in the taskbar, the pager, Alt+Tab or the Overview.

const { BrowserWindow, screen } = require('electron');
const { toPhysical, mergeRects, chooseDisplay, rectsEqual, toWindowRects } = require('./geometry');

const HIT_EVERY_MS = 33;    // input shape updates, at most ~30 a second
const POLL_EVERY_MS = 33;   // pointer polling when there's no input shape
const POINTER_EVERY_MS = 100;
const START = { w: 420, h: 520 };
const HIDE_FROM_DESKTOP = ['_NET_WM_STATE_SKIP_TASKBAR', '_NET_WM_STATE_SKIP_PAGER', '_KDE_NET_WM_STATE_SKIP_SWITCHER', '_NET_WM_STATE_ABOVE'];

const inside = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);

function createOverlay({ preload, url, x11, displayId = null }) {
  const pick = (id) => chooseDisplay(screen.getAllDisplays(), id, screen.getPrimaryDisplay().id);
  let wanted = displayId;
  let display = pick(wanted);

  // display-relative [x, y, w, h]: she starts in her corner; the renderer moves her from there
  const startViewport = () => {
    const b = display.bounds;
    const wa = display.workArea;
    return [wa.x - b.x + wa.width - START.w, wa.y - b.y + wa.height - START.h, START.w, START.h];
  };
  let viewport = startViewport();
  const screenBounds = ([x, y, w, h]) => ({ x: display.bounds.x + x, y: display.bounds.y + y, width: w, height: h });

  const win = new BrowserWindow({
    ...screenBounds(viewport),
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: true, // X11 size hints would otherwise pin her window to its first size
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    type: 'toolbar',
    title: 'Hexa',
    backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadURL(url);

  const xid = win.getNativeWindowHandle().readUInt32LE(0);
  const mode = x11?.hasShape ? 'shape' : 'poll';
  let dipRects = [];      // what the renderer says is clickable, in display DIP
  let applied = null;     // the input shape last sent to the X server
  let hitTimer = null;
  const timers = [];

  const area = () => {
    const b = display.bounds;
    const wa = display.workArea;
    return { x: wa.x - b.x, y: wa.y - b.y, w: wa.width, h: wa.height, scale: display.scaleFactor, originX: b.x, originY: b.y, width: b.width, height: b.height };
  };
  const sendArea = () => !win.isDestroyed() && win.webContents.send('overlay:area', area());
  const sendViewport = () => !win.isDestroyed() && win.webContents.send('viewport', viewport);

  function applyShape() {
    hitTimer = null;
    if (win.isDestroyed()) return;
    const phys = toPhysical(mergeRects(toWindowRects(dipRects, viewport), 16), display.scaleFactor);
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

  // The renderer needs to draw in [x, y, w, h] (display-relative): move her window there.
  function setViewport(rect) {
    if (win.isDestroyed()) return viewport;
    const [x, y] = rect.map(Math.round);
    const w = Math.min(display.bounds.width * 2, Math.max(64, Math.round(rect[2])));
    const h = Math.min(display.bounds.height * 2, Math.max(64, Math.round(rect[3])));
    viewport = [x, y, w, h];
    win.setBounds(screenBounds(viewport));
    applied = null; // the shape is relative to the window, which just moved
    if (mode === 'shape') applyShape();
    sendViewport();
    return viewport;
  }

  const pointer = () => {
    const p = screen.getCursorScreenPoint();
    return { x: p.x - display.bounds.x, y: p.y - display.bounds.y };
  };

  if (mode === 'shape') {
    x11.setInputRects(xid, []); // nothing is clickable until the renderer reports her
    applied = [];
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
    let catching = false;
    timers.push(setInterval(() => {
      const p = pointer();
      const now = inside(dipRects, p.x, p.y);
      if (now === catching || win.isDestroyed()) return;
      catching = now;
      win.setIgnoreMouseEvents(!now, { forward: true });
    }, POLL_EVERY_MS));
  }

  // where the pointer is, for her to look at it or shy away from it
  timers.push(setInterval(() => {
    if (win.isDestroyed()) return;
    const p = pointer();
    win.webContents.send('pointer', { ...p, inside: inside(dipRects, p.x, p.y) });
  }, POINTER_EVERY_MS));

  // a monitor plugged in, unplugged or resized: fit the display she's meant to be on
  function refit(id = wanted) {
    const before = display.id;
    wanted = id;
    display = pick(wanted);
    if (win.isDestroyed()) return display;
    if (display.id !== before) viewport = startViewport();
    win.setBounds(screenBounds(viewport));
    applied = null; // the scale may have changed: send the shape again
    if (mode === 'shape') applyShape();
    sendArea();
    sendViewport();
    return display;
  }
  const onDisplays = () => refit();
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  win.webContents.on('did-finish-load', () => {
    sendArea();
    sendViewport();
  });
  win.once('ready-to-show', () => {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    // Chromium makes this window override-redirect on X11, so the window manager never sees it:
    // already out of the taskbar, Alt+Tab and the Overview. If some setup manages it anyway, ask.
    x11?.isManaged(xid)
      .then((managed) => managed && x11.setWmState(xid, HIDE_FROM_DESKTOP))
      .catch((err) => console.error('[hexa] window states:', err.message));
  });

  return {
    win,
    xid,
    get display() { return display; },
    get viewport() { return viewport; },
    mode,
    setHitRects,
    setViewport,
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
