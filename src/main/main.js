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
const { screen } = require('electron');
const { playDemo } = require('./demo');
const { startX11Windows } = require('./platform/linux/windows-x11');
const { parentChain, windowForChain } = require('./platform/linux/proc');

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
  let windows = null;          // the window tracker
  let lastWindows = { fg: 0, wins: [] };
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
    const displays = screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Screen ${i + 1} (${d.bounds.width}×${d.bounds.height})`, current: d.id === overlay?.display.id }));
    return { visible: cfg.visible, scale: cfg.scale, muted: cfg.muted, wander: cfg.wander, possess: cfg.possess, follow: cfg.follow, displays, startAtLogin: autostart.isEnabled(), hooks: claudeHooks.status(), status: trayStatus };
  }

  const actions = {
    toggle: () => {
      const visible = !config.load().visible;
      config.save({ visible });
      send('hexa:command', { name: 'background', on: !visible }); // a set, not a flip: they can't drift apart
      trayHandle?.rebuild();
    },
    teleport: () => send('hexa:command', { name: 'teleport' }),
    guide: () => send('hexa:command', { name: 'guide' }),
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
    possess: (possess) => updateConfig({ possess }),
    follow: (follow) => updateConfig({ follow }),
    screen: (id) => {
      config.save({ displayId: id });
      moveTo(id);
      trayHandle?.rebuild();
    },
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

  // Her overlay to another display, and her appearing there.
  function moveTo(id) {
    if (!overlay || overlay.display.id === id) return;
    overlay.refit(id);
    send('hexa:command', { name: 'arrive' });
    trayHandle?.rebuild();
  }

  // the display your pointer is on
  const pointerDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

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
    if (name === 'state') return { ok: true, ...(await askRenderer()), overlay: overlay.mode, display: overlay.display.bounds, xid: overlay.xid, windows: lastWindows };
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
    ipcMain.handle('config:set', (_e, patch) => {
      // the renderer may only record what it learned, not change your settings behind your back
      const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ['welcomed', 'linked', 'visible'].includes(k)));
      return updateConfig(allowed);
    });
    ipcMain.on('hits:set', (_e, rects) => overlay?.setHitRects(rects));
    ipcMain.on('menu:open', () => trayHandle?.popup({ window: overlay.win }));
    ipcMain.handle('sounds:list', () => {
      try {
        return fs.readdirSync(path.join(paths.dataDir(), 'sounds')).filter((f) => SOUND_FILES.test(f));
      } catch {
        return [];
      }
    });
    ipcMain.handle('hooks:status', () => claudeHooks.status());
    // her guide: ~/.claude in your file manager, settings.json selected when it exists
    ipcMain.handle('guide:claudeFolder', () => {
      const file = claudeHooks.settingsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) shell.showItemInFolder(file);
      else shell.openPath(path.dirname(file));
      return true;
    });
    // where her tray icon is: the tray's own bounds when the desktop reports them (on KDE's
    // StatusNotifierItem it doesn't), else the panel's end of the screen, from the work area
    ipcMain.handle('guide:tray', () => {
      const d = overlay.display;
      const b = d.bounds;
      const wa = d.workArea;
      const t = trayHandle?.tray.getBounds?.();
      if (t && t.width > 0 && t.height > 0) return [t.x - b.x, t.y - b.y, t.width, t.height];
      if (wa.y > b.y) return [b.width - 260, 0, 240, wa.y - b.y];                                // panel on top
      const bottom = wa.y + wa.height;
      if (bottom < b.y + b.height) return [b.width - 260, bottom - b.y, 240, b.y + b.height - bottom]; // at the bottom
      return null; // no panel on this screen
    });
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

    if (x11) {
      windows = await startX11Windows({
        x11,
        selfXid: overlay.xid,
        getDisplay: () => overlay.display,
        onUpdate: (snap) => {
          lastWindows = snap;
          send('windows:update', snap);
        },
      }).catch((err) => {
        console.error('[hexa] window tracking unavailable:', err.message);
        return null;
      });
    }

    try {
      bridge = await createBridge({
        socketPath: paths.socketPath(),
        onEvent: (evt) => {
          // Claude needs you: she comes to the screen you're on first
          if (evt.hook_event_name === 'Notification' && ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(evt.notification_type)) {
            moveTo(pointerDisplay().id);
          }
          // Claude's window: the closest process up the hook's tree that owns one
          if (evt.ppid) {
            const win = windowForChain(parentChain(evt.ppid), lastWindows.wins);
            if (win) evt.window_id = win.id;
          }
          send('hexa:event', evt);
        },
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

    // your pointer on another screen for 3 s: she follows you there
    let awaySince = null;
    setInterval(() => {
      if (!overlay || !config.load().follow || !config.load().visible) {
        awaySince = null;
        return;
      }
      const d = pointerDisplay();
      if (d.id === overlay.display.id) {
        awaySince = null;
        return;
      }
      awaySince ??= Date.now();
      if (Date.now() - awaySince >= 3000) {
        awaySince = null;
        moveTo(d.id);
      }
    }, 500);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    bridge?.close();
    windows?.stop();
    overlay?.destroy();
    x11?.close();
  });
  // the overlay is the only window; closing it must not quit while the tray lives
  app.on('window-all-closed', (e) => e.preventDefault?.());

  module.exports = { actions };
}
