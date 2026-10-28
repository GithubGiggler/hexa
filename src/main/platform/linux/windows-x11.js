'use strict';

// Where your windows are, on X11: the window manager's stacking list on the root window, each
// window's frame, state, desktop and process, kept up to date from X events (no polling).
// Window titles are not read. Snapshots go out at most every 33 ms, however fast windows move.

const { frameRect, isTrackable, toSnapshot } = require('./window-model');

const EMIT_MS = 33;
const PROPERTY_CHANGE = 0x400000;
const STRUCTURE_NOTIFY = 0x20000;
const ATOMS = [
  '_NET_CLIENT_LIST_STACKING', '_NET_ACTIVE_WINDOW', '_NET_CURRENT_DESKTOP', '_NET_WM_WINDOW_TYPE', '_NET_WM_STATE',
  '_NET_WM_DESKTOP', '_NET_FRAME_EXTENTS', '_GTK_FRAME_EXTENTS', '_NET_WM_PID', 'WM_CLASS',
];

const call = (fn) => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

async function startX11Windows({ x11, selfXid = 0, getDisplay, onUpdate }) {
  const { X, root } = x11;
  const A = {};
  for (const name of ATOMS) A[name] = await call((cb) => X.InternAtom(false, name, cb));
  const names = new Map();
  const nameOf = async (id) => {
    if (!names.has(id)) names.set(id, await call((cb) => X.GetAtomName(id, cb)).catch(() => ''));
    return names.get(id);
  };
  const prop = (wid, atom, length = 64) => call((cb) => X.GetProperty(0, wid, atom, 0, 0, length, cb)).catch(() => null);
  const cards = (p) => {
    const out = [];
    for (let i = 0; p?.data && i + 4 <= p.data.length; i += 4) out.push(p.data.readUInt32LE(i));
    return out;
  };
  const atomsOf = async (p) => Promise.all(cards(p).map(nameOf));
  const extents = (p) => {
    const c = cards(p);
    return c.length === 4 ? c : null;
  };

  const wins = new Map();  // id → { id, client, frame, gtk, types, states, desktop, pid, cls }
  let order = [];          // bottom to top
  let fg = 0;
  let currentDesktop;
  let last = { fg: 0, wins: [] };
  let timer = null;
  let stopped = false;

  async function geometry(id) {
    const g = await call((cb) => X.GetGeometry(id, cb)).catch(() => null);
    const t = g && await call((cb) => X.TranslateCoordinates(id, root, 0, 0, cb)).catch(() => null);
    return g && t ? { x: t.destX, y: t.destY, w: g.width, h: g.height } : null;
  }

  async function load(id) {
    const [types, states, desktop, frame, gtk, pid, cls, client] = await Promise.all([
      prop(id, A._NET_WM_WINDOW_TYPE).then(atomsOf),
      prop(id, A._NET_WM_STATE).then(atomsOf),
      prop(id, A._NET_WM_DESKTOP).then((p) => cards(p)[0]),
      prop(id, A._NET_FRAME_EXTENTS).then(extents),
      prop(id, A._GTK_FRAME_EXTENTS).then(extents),
      prop(id, A._NET_WM_PID).then((p) => cards(p)[0] ?? null),
      prop(id, A.WM_CLASS).then((p) => (p?.data ? p.data.toString('latin1').split('\0').filter(Boolean).pop() || '' : '')),
      geometry(id),
    ]);
    wins.set(id, { id, client, frame, gtk, types, states, desktop, pid, cls });
    try {
      X.ChangeWindowAttributes(id, { eventMask: STRUCTURE_NOTIFY | PROPERTY_CHANGE });
    } catch {
      // gone already
    }
  }

  async function readRoot() {
    const [stacking, active, desk] = await Promise.all([
      prop(root, A._NET_CLIENT_LIST_STACKING, 1024),
      prop(root, A._NET_ACTIVE_WINDOW),
      prop(root, A._NET_CURRENT_DESKTOP),
    ]);
    order = cards(stacking);
    fg = cards(active)[0] || 0;
    currentDesktop = cards(desk)[0];
    for (const id of [...wins.keys()]) if (!order.includes(id)) wins.delete(id);
    await Promise.all(order.filter((id) => !wins.has(id)).map(load));
  }

  function emit() {
    timer = null;
    if (stopped) return;
    const d = getDisplay();
    const list = order
      .map((id) => wins.get(id))
      .filter((w) => w && w.client && isTrackable({ ...w, currentDesktop, isSelf: w.id === selfXid }))
      .map((w) => ({ id: w.id, rect: frameRect(w.client, w.frame, w.gtk), states: w.states, pid: w.pid, cls: w.cls }));
    last = toSnapshot(list, { display: d.bounds, scale: d.scaleFactor || 1, fg });
    onUpdate(last);
  }
  const schedule = () => {
    if (!timer && !stopped) timer = setTimeout(emit, EMIT_MS);
  };

  const onEvent = async (ev) => {
    if (stopped) return;
    try {
      if (ev.name === 'PropertyNotify') {
        if (ev.wid === root) {
          if (ev.atom === A._NET_CLIENT_LIST_STACKING || ev.atom === A._NET_ACTIVE_WINDOW || ev.atom === A._NET_CURRENT_DESKTOP) {
            await readRoot();
            schedule();
          }
          return;
        }
        const w = wins.get(ev.wid);
        if (!w) return;
        if (ev.atom === A._NET_WM_STATE) w.states = await atomsOf(await prop(ev.wid, A._NET_WM_STATE));
        else if (ev.atom === A._NET_WM_DESKTOP) w.desktop = cards(await prop(ev.wid, A._NET_WM_DESKTOP))[0];
        else if (ev.atom === A._NET_FRAME_EXTENTS) w.frame = extents(await prop(ev.wid, A._NET_FRAME_EXTENTS));
        else if (ev.atom === A._GTK_FRAME_EXTENTS) w.gtk = extents(await prop(ev.wid, A._GTK_FRAME_EXTENTS));
        else return;
        schedule();
      } else if (ev.name === 'ConfigureNotify') {
        const w = wins.get(ev.wid);
        if (!w) return;
        w.client = (await geometry(ev.wid)) || w.client;
        schedule();
      } else if (ev.name === 'UnmapNotify' || ev.name === 'DestroyNotify' || ev.name === 'MapNotify') {
        await readRoot();
        schedule();
      }
    } catch (err) {
      console.error('[hexa] window tracking:', err.message);
    }
  };
  X.on('event', onEvent);
  X.ChangeWindowAttributes(root, { eventMask: PROPERTY_CHANGE });
  await readRoot();
  emit();

  return {
    snapshot: () => last,
    async refresh() {
      await readRoot();
      emit();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      X.removeListener?.('event', onEvent);
    },
  };
}

module.exports = { startX11Windows };
