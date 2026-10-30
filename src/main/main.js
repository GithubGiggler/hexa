'use strict';

// Hexa's main process: the overlay she lives on, the bridge Claude Code talks to, her tray menu,
// and the few things only the main process can do (files, the X server, the system).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  app, Tray, Menu, ipcMain, protocol, net, shell, globalShortcut, nativeImage, powerMonitor, desktopCapturer,
} = require('electron');
const paths = require('./paths');
const config = require('./config');
const { createBridge } = require('./bridge');
const { createOverlay } = require('./overlay');
const { connect: connectX11 } = require('./platform/linux/x11');
const autostart = require('./platform/linux/autostart');
const claudeHooks = require('./hooks/claude');
const { createPermissions, clampWait } = require('./permissions');
const { createHub } = require('./brain/hub');
const { createSecrets } = require('./secrets');
const { createCapture } = require('./platform/linux/capture');
const { registerPrivileged, registerHexaProtocol } = require('./protocol');
const { buildMenu, toModel, createTray } = require('./tray');
const { trayLabels } = require('./labels');
const { screen } = require('electron');
const { playDemo } = require('./demo');
const { startX11Windows } = require('./platform/linux/windows-x11');
const { startKwinWindows } = require('./platform/linux/kwin');
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

let quitReason = 'a signal or the session ending';

if (!app.requestSingleInstanceLock()) {
  console.log('[hexa] another Hexa is already running: this one quits');
  quitReason = 'another Hexa is already running';
  app.quit();
} else {
  start();
}

function start() {
  let overlay = null;
  let bridge = null;
  let trayHandle = null;
  let shownMenu = null; // her own menu while it's open: { items, run }

  // While her menu is open, these keys are its (the overlay never has keyboard focus).
  const MENU_KEYS = ['Escape', 'Up', 'Down', 'Left', 'Right', 'Return'];
  let menuKeys = false;
  function grabMenuKeys(on) {
    if (on === menuKeys) return;
    menuKeys = on;
    for (const key of MENU_KEYS) {
      if (on) globalShortcut.register(key, () => send('menu:key', key));
      else globalShortcut.unregister(key);
    }
  }
  let x11 = null;
  let hub = null;
  let focusBefore = 0; // the window that had the keyboard before you typed to her
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

  // Answering permissions from her (opt-in; permissions.js). She doesn't offer when she's in the
  // background, Do Not Disturb is on, or you're away from the computer: Claude asks as usual.
  let doNotDisturb = false;
  const permissions = createPermissions({
    offer: () => {
      if (config.load().visible === false || doNotDisturb) return false;
      const idle = powerMonitor.getSystemIdleState(120);
      return idle !== 'idle' && idle !== 'locked';
    },
    show: (card) => send('permission:ask', card),
    hide: (id) => send('permission:gone', { id }),
    waitMs: () => clampWait(config.load().permissionWait),
  });

  const actions = {
    toggle: () => {
      const visible = !config.load().visible;
      config.save({ visible });
      send('hexa:command', { name: 'background', on: !visible }); // a set, not a flip: they can't drift apart
      trayHandle?.rebuild();
    },
    teleport: () => send('hexa:command', { name: 'teleport' }),
    lurk: () => send('hexa:command', { name: 'lurk' }),
    talk: () => send('hexa:command', { name: 'mainframe' }),
    fork: () => send('hexa:command', { name: 'fork' }),
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
    permissions: (on) => {
      try {
        if (on) claudeHooks.installPermission({ hookSource: path.join(appDir, 'hooks', 'hexa-permission-hook.js'), dataDir: paths.dataDir() });
        else claudeHooks.uninstallPermission();
        console.log(`[hexa] answering permissions from her: ${on ? 'on' : 'off'}`);
      } catch (err) {
        console.error('[hexa] could not change the permission hook:', err.message);
      }
      trayHandle?.rebuild();
    },
    removeHooks: () => {
      try {
        claudeHooks.uninstall();
      } catch (err) {
        console.error('[hexa] could not remove hooks:', err.message);
      }
      trayHandle?.rebuild();
    },
    quit: () => {
      quitReason = 'from her menu';
      app.quit();
    },
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
    // your click on her permission card: only her own page can send it, and each id answers once
    ipcMain.on('permission:answer', (e, answer) => {
      if (e.sender !== overlay?.win.webContents || !answer) return;
      if (permissions.answer(String(answer.id), String(answer.choice))) console.log(`[hexa] permission answered from her: ${answer.choice}`);
    });
    // her own menu (a right-click on her): the tray's, as data, drawn by her
    ipcMain.on('menu:open', () => {
      shownMenu = toModel(buildMenu(trayState(), t(), actions));
      send('menu:show', { items: shownMenu.items });
      grabMenuKeys(true);
    });
    ipcMain.on('menu:pick', (_e, id) => {
      const menu = shownMenu;
      shownMenu = null;
      grabMenuKeys(false);
      menu?.run(id);
    });
    ipcMain.on('menu:closed', () => {
      shownMenu = null;
      grabMenuKeys(false);
    });
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

    // her Mainframe (brain/hub.js); only her own page may ask
    const fromHer = (e) => e.sender === overlay?.win.webContents;
    ipcMain.handle('brain:status', (e) => (fromHer(e) ? hub.status() : null));
    ipcMain.handle('brain:models', (e, tier) => (fromHer(e) ? hub.listModels(String(tier)).catch((err) => ({ error: err.message })) : null));
    ipcMain.handle('brain:set', (e, patch) => (fromHer(e) ? hub.set(patch && typeof patch === 'object' ? patch : {}) : null));
    ipcMain.handle('brain:key', (e, key) => {
      if (!fromHer(e)) return null;
      try {
        if (key) hub.saveKey(String(key));
        else hub.clearKey();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    ipcMain.on('chat:send', (e, text) => { if (fromHer(e)) hub.send(String(text || '')); });
    ipcMain.on('chat:stop', (e) => { if (fromHer(e)) hub.stop(); });
    ipcMain.on('chat:reset', (e) => { if (fromHer(e)) hub.reset(); });
    // your click on her consent or question card (each id answers once)
    ipcMain.on('brain:answer', (e, a) => { if (fromHer(e) && a) hub.answer(String(a.id), String(a.value)); });
    ipcMain.on('computer:stop', (e) => { if (fromHer(e)) hub.stopComputer(); });
    // the keyboard, while you type to her
    // (her window is made unfocusable, and Chromium drops keys for such a window: focusable only
    // while you type to her)
    ipcMain.handle('focus:take', async (e) => {
      if (!fromHer(e) || !x11 || !overlay?.xid) return false;
      overlay.win.setFocusable(true);
      const before = await x11.takeFocus(overlay.xid);
      if (before && before !== overlay.xid) focusBefore = before;
      return true;
    });
    ipcMain.on('focus:give', (e) => {
      if (!fromHer(e)) return;
      overlay?.win.setFocusable(false);
      if (x11 && focusBefore) x11.giveFocus(focusBefore);
      focusBefore = 0;
    });
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

    // her brain: chat, her actions, computer use (brain/hub.js)
    hub = createHub({
      config, secrets: createSecrets(), send, shell, x11,
      capture: createCapture({ desktopCapturer, getDisplay: () => overlay.display, cursor: () => screen.getCursorScreenPoint() }),
      // Escape is hers only while she has your mouse and keyboard
      grabEscape: (stop) => {
        globalShortcut.register('Escape', stop);
        return () => globalShortcut.unregister('Escape');
      },
      dataDir: paths.dataDir(),
      onReminder: (text) => send('hexa:event', { hook_event_name: 'HexaReminder', text, demo: true }),
      // the live checks' scripted Claude (dev mode only; tools/ isn't shipped)
      makeClaude: DEV && process.env.HEXA_FAKE_CLAUDE
        ? () => require(path.join(appDir, 'tools', 'live', 'fake-claude.js')).createFakeClaude(process.env.HEXA_FAKE_CLAUDE)
        : null,
    });

    overlay = createOverlay({
      preload: path.join(__dirname, '..', 'preload.js'),
      url: 'hexa://app/src/renderer/index.html',
      x11,
      displayId: cfg.displayId,
    });
    console.log(`[hexa] overlay on display ${overlay.display.id} (${overlay.display.bounds.width}×${overlay.display.bounds.height}), click-through by ${overlay.mode}`);
    // in dev mode her page's warnings and errors land in her log too
    if (DEV) {
      overlay.win.webContents.on('console-message', (e) => {
        if (e.level === 'warning' || e.level === 'error') console.log(`[renderer] ${e.message} (${e.sourceId}:${e.lineNumber})`);
      });
    }

    // where your windows are: from KWin itself on Plasma Wayland (XWayland only sees its own
    // windows), from the X server everywhere else
    const onUpdate = (snap) => {
      lastWindows = snap;
      send('windows:update', snap);
    };
    const plasmaWayland = Boolean(process.env.WAYLAND_DISPLAY) && /KDE/i.test(process.env.XDG_CURRENT_DESKTOP || '');
    const startTracker = plasmaWayland
      ? () => startKwinWindows({ getDisplay: () => overlay.display, onUpdate })
      : x11 ? () => startX11Windows({ x11, selfXid: overlay.xid, getDisplay: () => overlay.display, onUpdate }) : null;
    windows = startTracker ? await startTracker().catch((err) => {
      console.error('[hexa] window tracking unavailable:', err.message);
      return null;
    }) : null;
    if (windows) console.log(`[hexa] window tracking by ${plasmaWayland ? 'KWin' : 'X11'}`);

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
        onPermission: (ask, ctx) => permissions.request(ask, ctx),
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

  // why she stopped, for the log. Electron answers SIGTERM and SIGINT itself (a Node handler for
  // them never runs), so a quit nobody asked for here is a signal or the session ending.
  app.on('before-quit', () => console.log(`[hexa] quitting (${quitReason})`));

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
