'use strict';

// What the window tracker knows about your windows, as plain data, so the rules can be tested
// without an X server: where a window really is (frame or client-side shadow), which windows count,
// and the snapshot Hexa gets (front first, in her display's DIP coordinates).

// Not windows she could sit on or would care about.
const SKIP_TYPES = [
  '_NET_WM_WINDOW_TYPE_DOCK',
  '_NET_WM_WINDOW_TYPE_DESKTOP',
  '_NET_WM_WINDOW_TYPE_MENU',
  '_NET_WM_WINDOW_TYPE_DROPDOWN_MENU',
  '_NET_WM_WINDOW_TYPE_POPUP_MENU',
  '_NET_WM_WINDOW_TYPE_TOOLTIP',
  '_NET_WM_WINDOW_TYPE_NOTIFICATION',
  '_NET_WM_WINDOW_TYPE_SPLASH',
  '_NET_WM_WINDOW_TYPE_DND',
  '_NET_WM_WINDOW_TYPE_COMBO',
];
const ALL_DESKTOPS = 0xffffffff;

// The rectangle you see: the client grown by the window manager's frame (_NET_FRAME_EXTENTS), or
// shrunk by the shadow a client-side-decorated (GTK) window draws inside itself (_GTK_FRAME_EXTENTS).
// Extents are [left, right, top, bottom].
function frameRect({ x, y, w, h }, frame, gtk) {
  let r = { x, y, w, h };
  if (frame) {
    const [l, rt, t, b] = frame;
    r = { x: r.x - l, y: r.y - t, w: r.w + l + rt, h: r.h + t + b };
  }
  if (gtk) {
    const [l, rt, t, b] = gtk;
    r = { x: r.x + l, y: r.y + t, w: r.w - l - rt, h: r.h - t - b };
  }
  return r;
}

function isTrackable({ types = [], states = [], desktop, currentDesktop, isSelf = false }) {
  if (isSelf) return false;
  if (types.some((t) => SKIP_TYPES.includes(t))) return false;
  if (states.includes('_NET_WM_STATE_HIDDEN')) return false; // minimised
  if (desktop !== undefined && desktop !== ALL_DESKTOPS && currentDesktop !== undefined && desktop !== currentDesktop) return false;
  return true;
}

const maximised = (states) => states.includes('_NET_WM_STATE_FULLSCREEN')
  || (states.includes('_NET_WM_STATE_MAXIMIZED_VERT') && states.includes('_NET_WM_STATE_MAXIMIZED_HORZ'));

// list: bottom to top (X's stacking order), each { id, rect (physical px, root), states, pid, cls }.
// Returns { fg, wins } with wins front first, in DIP relative to the display, only those on it.
function toSnapshot(list, { display, scale = 1, fg = 0 }) {
  const wins = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    const x = w.rect.x / scale - display.x;
    const y = w.rect.y / scale - display.y;
    const ww = w.rect.w / scale;
    const hh = w.rect.h / scale;
    if (x >= display.width || y >= display.height || x + ww <= 0 || y + hh <= 0) continue;
    wins.push({ id: w.id, x, y, w: ww, h: hh, max: maximised(w.states || []), pid: w.pid ?? null, cls: w.cls ?? '' });
  }
  return { fg, wins };
}

module.exports = { frameRect, isTrackable, toSnapshot, SKIP_TYPES, ALL_DESKTOPS };
