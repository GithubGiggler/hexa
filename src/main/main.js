'use strict';

// Hexa's main process: the overlay she lives on, the bridge Claude Code talks to, her tray menu,
// and the few things only the main process can do (files, the X server, the system).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  app, Tray, Menu, ipcMain, protocol, net, shell, globalShortcut, nativeImage, powerMonitor,
} = require('electron');
const paths = require('./paths');
const config = require('./config');
const { createBridge } = require('./bridge');
const { createOverlay } = require('./overlay');
const { connect: connectX11 } = require('./platform/linux/x11');
const autostart = require('./platform/linux/autostart');
const claudeHooks = require('./hooks/claude');
const { registerPrivileged, registerHexaProtocol } = require('./protocol');
const { buildMenu, createTray } = require('./tray');
const { trayLabels } = require('./labels');
const { playDemo } = require('./demo');

const DEV = process.argv.includes('--dev');
const appDir = app.getAppPath();
const SOUND_FILES = /\.(mp3|wav|ogg|m4a)$/i;

// ---- before ready ----

// On Plasma Wayland she runs through XWayland, where her click-through input shape still works.
if (process.env.WAYLAND_DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');
registerPrivileged(protocol);
app.setName('Hexa');
app.setPath('userData', paths.dataDir());
const cacheBase = process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME) ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
app.setPath('sessionData', path.join(cacheBase, 'hexa', 'session')); // Chromium's caches stay out of your data

// Everything she logs also goes to ~/.local/state/hexa/hexa.log.
const logFile = path.join(paths.stateDir(), 'hexa.log');
try {
  fs.mkdirSync(paths.stateDir(), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      log.write(`${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
    };
  }
} catch {
  // no log file: the console still works
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  let overlay = null;
  let bridge = null;
  let trayHandle = null;
  let x11 = null;
  let reducedMotion = false;
  let trayStatus = null;
  let stopDemo = null;
  const pendingState = new Map();
  let stateSeq = 0;

  const t = () => trayLabels('en');
  const send = (channel, payload) => {
    if (overlay && !overlay.win.isDestroyed()) overlay.win.webContents.send(channel, payload);
  };
  const rendererConfig = () => ({ ...config.load(), reducedMotion, lang: 'en', packUrl: 'hexa://app/packs/hexa/pack.json' });

  function updateConfig(patch) {
    config.save(patch);
    send('hexa:config', rendererConfig());
    trayHandle?.rebuild();
    return rendererConfig();
  }

  function installHooks() {
    try {
      const r = claudeHooks.install({ hookSource: path.join(appDir, 'hooks', 'hexa-hook.js'), dataDir: paths.dataDir() });
      console.log(`[hexa] hooks installed in ${r.file}`);
      return { ok: true, ...r };
    } catch (err) {
      console.error('[hexa] could not install hooks:', err.message);
      return { ok: false, error: err.message };
    } finally {
      trayHandle?.rebuild();
    }
  }

  function trayState() {
    const cfg = config.load();
    return { visible: cfg.visible, scale: cfg.scale, muted: cfg.muted, wander: cfg.wander, startAtLogin: autostart.isEnabled(), hooks: claudeHooks.status(), status: trayStatus };
  }

  const actions = {
    toggle: () => {
      const visible = !config.load().visible;
      config.save({ visible });
      send('hexa:command', { name: 'background' });
      trayHandle?.rebuild();
    },
    teleport: () => send('hexa:command', { name: 'teleport' }),
    demo: () => {
      stopDemo?.();
      stopDemo = playDemo((evt) => send('hexa:event', evt));
    },
    size: (scale) => updateConfig({ scale }),
    mute: (muted) => updateConfig({ muted }),
    soundsDir: () => {
      const dir = path.join(paths.dataDir(), 'sounds');
      fs.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
    },
    wander: (wander) => updateConfig({ wander }),
    startup: (on) => {
      if (on) autostart.enable({ exec: process.env.APPIMAGE || process.execPath, args: app.isPackaged ? [] : [appDir] });
      else autostart.disable();
      config.save({ startAtLogin: on });
      trayHandle?.rebuild();
    },
    installHooks,
    removeHooks: () => {
      try {
        claudeHooks.uninstall();
      } catch (err) {
        console.error('[hexa] could not remove hooks:', err.message);
      }
      trayHandle?.rebuild();
    },
    quit: () => app.quit(),
  };

  // a question only the renderer can answer (where she is, what she's doing), for /debug/state
  function askRenderer() {
    return new Promise((resolve) => {
      const id = ++stateSeq;
      pendingState.set(id, resolve);
      send('debug:state', id);
      setTimeout(() => {
        if (pendingState.delete(id)) resolve({ error: 'renderer did not answer' });
      }, 2000);
    });
  }

  async function onDebug(name) {
    if (name === 'capture') {
      const image = await overlay.win.webContents.capturePage();
      const dir = path.join(appDir, 'captures');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      fs.writeFileSync(file, image.toPNG());
      return { ok: true, file };
    }
    if (name === 'state') {
      const wm = x11 ? await x11.windowInfo(overlay.xid).catch((err) => ({ error: err.message })) : null;
      return { ok: true, ...(await askRenderer()), overlay: overlay.mode, display: overlay.display.bounds, window: overlay.win.getBounds(), viewport: overlay.viewport, wm };
    }
    return { ok: false, error: `no debug route "${name}"` };
  }

  async function onCli(cmd) {
    if (cmd === 'status') return { body: { ok: true, visible: config.load().visible } };
    return { status: 404, body: { ok: false, error: `unknown command "${cmd}"` } };
  }

  // Plasma's "animation speed: instant", or GNOME's animations off: she sticks to fades.
  function detectReducedMotion() {
    return new Promise((resolve) => {
      execFile('kreadconfig6', ['--group', 'KDE', '--key', 'AnimationDurationFactor'], { timeout: 3000 }, (err, out) => {
        if (!err && out.trim() === '0') return resolve(true);
        execFile('gsettings', ['get', 'org.gnome.desktop.interface', 'enable-animations'], { timeout: 3000 }, (err2, out2) => {
          resolve(!err2 && out2.trim() === 'false');
        });
      });
    });
  }

  function registerIpc() {
    ipcMain.handle('config:get', () => rendererConfig());
    ipcMain.handle('overlay:area', () => overlay.area());
    ipcMain.handle('viewport:get', () => overlay.viewport);
    ipcMain.handle('config:set', (_e, patch) => {
      // the renderer may only record what it learned, not change your settings behind your back
      const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ['welcomed', 'linked'].includes(k)));
      return updateConfig(allowed);
    });
    ipcMain.on('hits:set', (_e, rects) => overlay?.setHitRects(rects));
    // the renderer needs her window somewhere else, or bigger for a moment
    ipcMain.on('viewport:set', (_e, rect) => {
      if (Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite)) overlay?.setViewport(rect);
    });
    ipcMain.on('menu:open', () => trayHandle?.popup({ window: overlay.win }));
    ipcMain.handle('sounds:list', () => {
      try {
        return fs.readdirSync(path.join(paths.dataDir(), 'sounds')).filter((f) => SOUND_FILES.test(f));
      } catch {
        return [];
      }
    });
    ipcMain.handle('hooks:status', () => claudeHooks.status());
    ipcMain.handle('hooks:install', () => installHooks());
    ipcMain.on('debug:state', (_e, { id, state }) => {
      const resolve = pendingState.get(id);
      if (resolve) {
        pendingState.delete(id);
        resolve(state);
      }
    });
  }

  app.whenReady().then(async () => {
    registerHexaProtocol({ protocol, net, appDir, dataDir: paths.dataDir() });
    const cfg = config.load();
    x11 = await connectX11();
    if (!x11) console.warn('[hexa] no X11 connection: falling back to pointer polling for click-through');
    reducedMotion = await detectReducedMotion();
    registerIpc();

    overlay = createOverlay({
      preload: path.join(__dirname, '..', 'preload.js'),
      url: 'hexa://app/src/renderer/index.html',
      x11,
      displayId: cfg.displayId,
    });
    console.log(`[hexa] overlay on display ${overlay.display.id} (${overlay.display.bounds.width}×${overlay.display.bounds.height}), click-through by ${overlay.mode}`);

    try {
      bridge = await createBridge({
        socketPath: paths.socketPath(),
        onEvent: (evt) => send('hexa:event', evt),
        onCli,
        onDebug: DEV ? onDebug : undefined,
      });
      console.log(`[hexa] listening on ${paths.socketPath()}`);
    } catch (err) {
      console.error(`[hexa] bridge: ${err.message}`);
    }

    if (x11 && !(await x11.hasCompositor().catch(() => true))) {
      trayStatus = t().compositor;
      console.warn('[hexa] no compositing manager: her background will not be transparent');
    }

    const icon = nativeImage.createFromPath(path.join(appDir, 'assets', 'icons', 'tray.png'));
    trayHandle = createTray({ Tray, Menu, icon, getMenu: () => buildMenu(trayState(), t(), actions) });

    if (!globalShortcut.register(cfg.shortcut, actions.toggle)) console.warn(`[hexa] could not register ${cfg.shortcut}`);
    powerMonitor.on('resume', () => send('hexa:command', { name: 'resume' }));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    bridge?.close();
    overlay?.destroy();
    x11?.close();
  });
  // the overlay is the only window; closing it must not quit while the tray lives
  app.on('window-all-closed', (e) => e.preventDefault?.());

  module.exports = { actions };
}
