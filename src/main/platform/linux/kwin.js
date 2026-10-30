'use strict';

// Where your windows are, on Plasma Wayland. Hexa's own window runs through XWayland there, which
// only sees other XWayland windows, so KWin itself reports the real list: Hexa exports a small
// D-Bus service, loads kwin-script/ into KWin, and the script calls it whenever windows change.

const path = require('node:path');
const { toSnapshot } = require('./window-model');

const SCRIPT_DIR = path.join(__dirname, 'kwin-script').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const PLUGIN = 'hexa-windows';
const SERVICE = 'io.github.hexa';
const OBJECT = '/io/github/hexa/Windows';
const IFACE = 'io.github.hexa.Windows';

// The script's JSON → the same { fg, wins } snapshot the X11 tracker gives. KWin's coordinates are
// already logical (DIP).
function parseKwinReport(json, { display, scale = 1 }) {
  let r;
  try {
    r = JSON.parse(json);
  } catch {
    return { fg: 0, wins: [] };
  }
  const list = (r.wins || [])
    .filter((w) => !w.minimized && (w.onAll || !w.desktops?.length || w.desktops.includes(r.desktop)))
    .map((w) => ({
      id: w.id,
      rect: { x: w.x, y: w.y, w: w.w, h: w.h },
      states: w.fullScreen ? ['_NET_WM_STATE_FULLSCREEN'] : w.maximized ? ['_NET_WM_STATE_MAXIMIZED_VERT', '_NET_WM_STATE_MAXIMIZED_HORZ'] : [],
      pid: w.pid ?? null,
      cls: w.cls || '',
    }));
  return toSnapshot(list, { display, scale, fg: r.active || 0 });
}

async function startKwinWindows({ getDisplay, onUpdate }) {
  const dbus = require('dbus-next');
  const bus = dbus.sessionBus();
  let last = { fg: 0, wins: [] };
  class Windows extends dbus.interface.Interface {
    update(json) {
      last = parseKwinReport(json, { display: getDisplay().bounds, scale: 1 });
      onUpdate(last);
    }
  }
  Windows.configureMembers({ methods: { update: { inSignature: 's', outSignature: '' } } });
  bus.export(OBJECT, new Windows(IFACE));
  await bus.requestName(SERVICE, 0);
  const scripting = (await bus.getProxyObject('org.kde.KWin', '/Scripting')).getInterface('org.kde.kwin.Scripting');
  await scripting.unloadScript(PLUGIN).catch(() => {}); // a copy left by a previous run
  await scripting.loadScript(path.join(SCRIPT_DIR, 'contents', 'code', 'main.js'), PLUGIN);
  await scripting.start();
  return {
    snapshot: () => last,
    async refresh() {},
    stop() {
      scripting.unloadScript(PLUGIN).catch(() => {});
      bus.disconnect();
    },
  };
}

module.exports = { parseKwinReport, startKwinWindows, SCRIPT_DIR };
