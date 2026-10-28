'use strict';

// Hexa's own connection to the X server (pure JavaScript, no native build). For now it does one
// job: the overlay's input shape, so clicks land on her body and pass through everywhere else,
// routed by the X server itself with no pointer polling. Window tracking (M2) joins it here.

const x11 = require('x11');

const call = (fn) => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

// A _NET_WM_STATE request as the EWMH spec wants it: a 32-byte ClientMessage sent to the root
// window. action 1 adds the states, 0 removes them; the last 1 says it comes from an application.
function wmStateEvent(window, typeAtom, action, stateA, stateB = 0) {
  const buf = Buffer.alloc(32);
  buf.writeUInt8(33, 0);           // ClientMessage
  buf.writeUInt8(32, 1);           // format: 32-bit data
  buf.writeUInt32LE(window >>> 0, 4);
  buf.writeUInt32LE(typeAtom >>> 0, 8);
  buf.writeUInt32LE(action, 12);
  buf.writeUInt32LE(stateA >>> 0, 16);
  buf.writeUInt32LE(stateB >>> 0, 20);
  buf.writeUInt32LE(1, 24);
  return buf;
}

const SUBSTRUCTURE = (1 << 19) | (1 << 20); // SubstructureNotify | SubstructureRedirect

function createClient(display) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    setTimeout(() => finish(null), 2000).unref();
    try {
      const client = x11.createClient(display ? { display } : {}, (err, d) => finish(err ? null : d));
      client.on('error', (err) => {
        // after setup, errors from single requests land here; they must not crash the app
        if (done) console.error('[hexa] x11:', err.message);
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

async function connect() {
  if (!process.env.DISPLAY) return null;
  const display = await createClient(process.env.DISPLAY);
  if (!display) return null;
  const X = display.client;
  const screen = display.screen[0];
  const root = screen.root;
  let Shape = null;
  try {
    Shape = await call((cb) => X.require('shape', cb));
  } catch {
    // no SHAPE extension: the overlay falls back to pointer polling
  }

  return {
    X,
    root,
    hasShape: Boolean(Shape),

    // Only these rectangles of the window take the pointer; the rest of it is see-through to clicks.
    // Coordinates are physical pixels relative to the window.
    setInputRects(xid, rects) {
      if (!Shape) throw new Error('no SHAPE extension');
      Shape.Rectangles(Shape.Op.Set, Shape.Kind.Input, xid, 0, 0, rects, Shape.Ordering.Unsorted);
    },

    // The top-level window a click at (x, y) on the root would go to. Honours input shapes.
    async whoAt(x, y) {
      const r = await call((cb) => X.TranslateCoordinates(root, root, x, y, cb));
      return r.child;
    },

    // A compositing manager owns the _NET_WM_CM_S<n> selection; without one there's no transparency.
    async hasCompositor() {
      const atom = await call((cb) => X.InternAtom(false, `_NET_WM_CM_S${display.screenNum || 0}`, cb));
      const owner = await call((cb) => X.GetSelectionOwner(atom, cb));
      return owner !== 0;
    },

    // Asks the window manager to add states to a window, e.g. keep it out of the taskbar and Alt+Tab.
    async setWmState(xid, names) {
      const type = await call((cb) => X.InternAtom(false, '_NET_WM_STATE', cb));
      const atoms = [];
      for (const name of names) atoms.push(await call((cb) => X.InternAtom(false, name, cb)));
      for (let i = 0; i < atoms.length; i += 2) {
        X.SendEvent(root, false, SUBSTRUCTURE, wmStateEvent(xid, type, 1, atoms[i], atoms[i + 1] || 0));
      }
    },

    // Is the window manager managing this window? An override-redirect window (what Chromium makes
    // of a frameless 'toolbar') isn't: no taskbar, pager, Alt+Tab or Overview, and no focus.
    async isManaged(xid) {
      const a = await call((cb) => X.GetWindowAttributes(xid, cb));
      return !a.overrideRedirect;
    },

    // For checking: whether it's managed, and its _NET_WM_STATE as atom names.
    async windowInfo(xid) {
      const managed = await this.isManaged(xid);
      const type = await call((cb) => X.InternAtom(false, '_NET_WM_STATE', cb));
      const prop = await call((cb) => X.GetProperty(0, xid, type, 0, 0, 64, cb));
      const state = [];
      for (let i = 0; prop.data && i + 4 <= prop.data.length; i += 4) state.push(await call((cb) => X.GetAtomName(prop.data.readUInt32LE(i), cb)));
      return { managed, state };
    },

    // A round trip: every request sent before it has been handled when it resolves.
    sync() {
      return call((cb) => X.GetInputFocus(cb));
    },

    close() {
      try {
        X.terminate?.();
        X.close?.();
      } catch {
        // already gone
      }
    },
  };
}

module.exports = { connect, wmStateEvent };
