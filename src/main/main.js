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
// every assistant's hooks: Claude Code's, the Codex CLI's, Antigravity's
const assistants = require('./hooks');
const { createPermissions, clampWait } = require('./permissions');
const { createHub } = require('./brain/hub');
const { createSecrets } = require('./secrets');
const { createCapture } = require('./platform/linux/capture');
const { createVoiceInput } = require('./brain/voice-input');
const { startSense } = require('./platform/linux/sense');
const { createBond } = require('./bond');
const { registerPrivileged, registerHexaProtocol } = require('./protocol');
const { buildMenu, toModel, createTray } = require('./tray');
const { trayLabels } = require('./labels');
const { resolveLang } = require('./lang');
const { screen } = require('electron');
const { playDemo } = require('./demo');
const { startX11Windows } = require('./platform/linux/windows-x11');
const { startKwinWindows } = require('./platform/linux/kwin');
const { parentChain, windowForChain } = require('./platform/linux/proc');
// usage and history (spec §7.3)
const { createHistory } = require('./usage/history');
const { createStatsWindow } = require('./usage/stats-window');
const { statsCli } = require('./usage/report');
// the hexa CLI, notifications while she's away, Do Not Disturb and music
const { createCli, createSessionList } = require('./cli');
const { createNotices } = require('./notices');
const { openSessionBus } = require('./platform/linux/session-bus');
const { createNotifier } = require('./platform/linux/notifications');
const { startDnd } = require('./platform/linux/dnd');
const { startMpris } = require('./platform/linux/mpris');

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
  // past 5 MB her log starts over (the last one kept as hexa.log.1)
  try {
    if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* no log yet */ }
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

// `hexa status`, `hexa say hi`...: in a packaged install her binary is also the CLI (bin/hexa.js).
// The first argument that isn't a Chromium flag or the app's folder decides: one of the CLI's
// commands, and the CLI runs and exits without starting her.
function cliArgs(argv) {
  const words = argv.slice(1).filter((a, i) => !(i === 0 && (a === '.' || a === appDir)) && !/^--(no-sandbox|dev|enable-|disable-|ozone)/.test(a));
  const cli = require('../../bin/hexa');
  return words.length && cli.isCommand(words[0]) ? { cli, args: words } : null;
}
const asCli = cliArgs(process.argv);

if (asCli) {
  // (process.exit, not app.exit: this runs before Electron is ready, and she never starts)
  asCli.cli.main(asCli.args).then((code) => process.exit(code ?? 0), (err) => {
    process.stderr.write(`hexa: ${err.message}\n`);
    process.exit(1);
  });
} else if (!app.requestSingleInstanceLock()) {
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
  // how close you two are (bond.js): a new stage brings her forks out
  const bond = createBond({
    file: path.join(paths.dataDir(), 'bond.json'),
    onStage: (st) => {
      send('hexa:event', { hook_event_name: 'HexaBond', up: true, stage: st.name, index: st.index, demo: true });
      pushBond();
      trayHandle?.rebuild();
    },
  });
  const pushBond = () => send('bond:state', { ...bond.stage(), points: bond.points(), days: bond.days() });
  setInterval(() => bond.credit('minutes', 1), 60000).unref();
  setInterval(() => bond.flush(), 5 * 60000).unref();
  let focusBefore = 0; // the window that had the keyboard before you typed to her
  let lastHits = []; // where her page takes clicks (CSS px), for computer use's hersAt
  let reducedMotion = false;
  let trayStatus = null;
  let stopDemo = null;
  let windows = null;          // the window tracker
  let lastWindows = { fg: 0, wins: [] };
  const pendingState = new Map();
  let stateSeq = 0;

  // ---- usage and history (spec §7.3) ----
  // Every bridge event is counted into her daily records (onEvent below); "Usage and stats" in
  // her menu opens the stats window over them, and /cli/stats answers `hexa stats`. The window's
  // IPC handlers (stats:get, stats:export) are registered by createStatsWindow and answer only it.
  const history = createHistory({ dir: path.join(paths.dataDir(), 'history') });
  const statsWindow = createStatsWindow({
    history,
    preload: path.join(__dirname, '..', 'stats-preload.js'),
    icon: path.join(appDir, 'assets', 'icons', 'hexa-128.png'),
  });

  // her language: the config's, or 'auto' from your locale (lang.js); menus and lines both follow it
  const lang = () => resolveLang(config.load().lang, process.env);
  const t = () => trayLabels(lang());
  const send = (channel, payload) => {
    if (overlay && !overlay.win.isDestroyed()) overlay.win.webContents.send(channel, payload);
  };
  // whose work she follows: 'claude', 'codex' or 'agy' (her menu's Watch)
  const watched = () => assistants.assistantOf(config.load().assistant) || 'claude';
  const rendererConfig = () => ({ ...config.load(), assistant: watched(), reducedMotion, lang: lang(), packUrl: 'hexa://app/packs/hexa/pack.json' });

  function updateConfig(patch) {
    config.save(patch);
    send('hexa:config', rendererConfig());
    trayHandle?.rebuild();
    return rendererConfig();
  }

  // The hooks of the assistant she watches, unless told whose.
  function installHooks(assistant = watched()) {
    try {
      const r = assistants.install(assistant, { appDir, dataDir: paths.dataDir() });
      console.log(`[hexa] ${assistant} hooks installed in ${r.file}`);
      return { ok: true, ...r };
    } catch (err) {
      console.error(`[hexa] could not install ${assistant} hooks:`, err.message);
      return { ok: false, error: err.message };
    } finally {
      trayHandle?.rebuild();
    }
  }

  function uninstallHooks(assistant = watched()) {
    try {
      return assistants.uninstall(assistant);
    } finally {
      trayHandle?.rebuild();
    }
  }

  function trayState() {
    const cfg = config.load();
    const screenName = t().display;
    const displays = screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `${screenName.replace('{n}', i + 1)} (${d.bounds.width}×${d.bounds.height})`, current: d.id === overlay?.display.id }));
    const assistant = watched();
    return { visible: cfg.visible, scale: cfg.scale, muted: cfg.muted, wander: cfg.wander, possess: cfg.possess, jealous: cfg.jealous, follow: cfg.follow, displays, startAtLogin: autostart.isEnabled(), assistant, hooks: assistants.status(assistant), status: trayStatus || `Hexa · ${bond.stage().name}` };
  }

  // Answering permissions from her (opt-in; permissions.js). She doesn't offer when she's in the
  // background, Do Not Disturb is on, or you're away from the computer: Claude asks as usual.
  let doNotDisturb = false;
  const permissions = createPermissions({
    offer: () => {
      // nor while she watches another assistant: Claude Code's prompts aren't hers to bring you then
      // nor while she's busy with your mouse and keyboard
      if (config.load().visible === false || doNotDisturb || watched() !== 'claude' || hub?.working) return false;
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
    stats: () => statsWindow.open(), // usage and history
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
    jealous: (jealous) => updateConfig({ jealous }),
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
    installHooks: () => installHooks(),
    // whose work she follows; her brain drops the sessions of the one she stops watching
    watch: (assistant) => {
      const id = assistants.assistantOf(assistant);
      if (id) updateConfig({ assistant: id });
    },
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
        uninstallHooks();
      } catch (err) {
        console.error('[hexa] could not remove hooks:', err.message);
      }
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

  // ---- the hexa CLI, notifications while she's away, Do Not Disturb and music ----
  // One session bus for all three. Without one: no Do Not Disturb or music, and notify-send.
  const sessionBus = openSessionBus();
  const notifier = createNotifier({ bus: sessionBus, icon: path.join(appDir, 'assets', 'icons', 'hexa-128.png') });
  let dnd = null;   // startDnd's watcher, once the bus has answered
  let mpris = null; // startMpris's
  const linuxState = () => ({ dnd: dnd?.get() ?? false, music: mpris?.get() ?? null });
  const cliSessions = createSessionList(); // what `hexa status` and `hexa sessions` report
  const cli = createCli({
    send,
    config,
    actions,
    sessions: cliSessions.list,
    notify: notifier.notify,
    linux: linuxState,
    version: app.getVersion(),
    // `hexa stats`: the usage summary (usage/report.js)
    stats: (q) => {
      const r = statsCli(history, q);
      return r.status ? r : r.body;
    },
    // `hexa hooks … --assistant <claude|codex|agy>` (cli.js checks the name and defaults to claude)
    hooks: {
      install: (assistant) => installHooks(assistant),
      uninstall: (assistant) => uninstallHooks(assistant),
      status: (assistant) => assistants.status(assistant),
    },
  });
  // in the background, or with Do Not Disturb on, her assistant's news comes as a notification
  // (only the one she watches); its only button, Show, brings her back
  const notices = createNotices({
    notify: notifier.notify,
    away: () => config.load().visible === false || linuxState().dnd,
    follows: (evt) => assistants.ownerOf(evt) === watched(),
  });
  notifier.onAction((_id, action) => {
    if (action === 'show') cli.handle('show', {});
  });

  // Not awaited: a bus that never answers must not hold her up. The renderer hears { dnd, music }
  // on 'linux:state' whenever either changes, and again whenever her page (re)loads.
  function startLinuxState() {
    if (!sessionBus) return;
    const push = () => send('linux:state', linuxState());
    overlay.win.webContents.on('did-finish-load', push);
    startDnd({ bus: sessionBus }).then((d) => {
      dnd = d;
      doNotDisturb = d.get(); // her permission card isn't offered while it's on
      d.onChange((on) => {
        doNotDisturb = on;
        push();
      });
      push();
    }, (err) => console.warn('[hexa] Do Not Disturb unavailable:', err.message));
    startMpris({ bus: sessionBus }).then((m) => {
      mpris = m;
      m.onChange(push);
      push();
    }, (err) => console.warn('[hexa] MPRIS unavailable:', err.message));
  }

  function onCli(cmd, body) {
    return cli.handle(cmd, body);
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
    // Only her own page may ask anything of main: her window, its top frame, at hexa://app/ (were
    // it ever made to load anything else, nothing here would answer it).
    const fromHer = (e) => e.sender === overlay?.win.webContents && e.senderFrame === e.sender.mainFrame
      && String(e.senderFrame?.url || '').startsWith('hexa://app/');
    const onHer = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (fromHer(e)) fn(e, ...args); });
    const handleHer = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (fromHer(e) ? fn(e, ...args) : null));
    handleHer('config:get', () => rendererConfig());
    handleHer('overlay:area', () => overlay.area());
    handleHer('config:set', (_e, patch) => {
      // the renderer may only record what it learned, not change your settings behind your back
      const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ['welcomed', 'linked', 'visible'].includes(k)));
      return updateConfig(allowed);
    });
    onHer('hits:set', (e, rects) => {
      if (e.sender !== overlay?.win.webContents || !Array.isArray(rects)) return;
      lastHits = rects.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite));
      overlay.setHitRects(lastHits);
    });
    // your click on her permission card: only her own page can send it, and each id answers once
    onHer('permission:answer', (e, answer) => {
      if (e.sender !== overlay?.win.webContents || !answer) return;
      if (!permissions.answer(String(answer.id), String(answer.choice))) return;
      console.log(`[hexa] permission answered from her: ${answer.choice}`);
      if (answer.choice === 'allow' || answer.choice === 'always') history.approvedViaHexa();
    });
    // her own menu (a right-click on her): the tray's, as data, drawn by her
    onHer('menu:open', () => {
      shownMenu = toModel(buildMenu(trayState(), t(), actions));
      send('menu:show', { items: shownMenu.items });
      grabMenuKeys(true);
    });
    onHer('menu:pick', (_e, id) => {
      const menu = shownMenu;
      shownMenu = null;
      grabMenuKeys(false);
      menu?.run(id);
    });
    onHer('menu:closed', () => {
      shownMenu = null;
      grabMenuKeys(false);
    });
    handleHer('sounds:list', () => {
      try {
        return fs.readdirSync(path.join(paths.dataDir(), 'sounds')).filter((f) => SOUND_FILES.test(f));
      } catch {
        return [];
      }
    });
    handleHer('hooks:status', () => claudeHooks.status());
    // her guide: ~/.claude in your file manager, settings.json selected when it exists
    handleHer('guide:claudeFolder', () => {
      const file = claudeHooks.settingsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) shell.showItemInFolder(file);
      else shell.openPath(path.dirname(file));
      return true;
    });
    // where her tray icon is: the tray's own bounds when the desktop reports them (on KDE's
    // StatusNotifierItem it doesn't), else the panel's end of the screen, from the work area
    handleHer('guide:tray', () => {
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
    // her guide is about Claude Code: its hooks, whoever she watches
    handleHer('hooks:install', () => installHooks('claude'));

    // her Mainframe (brain/hub.js); only her own page may ask
    handleHer('brain:status', (e) => (fromHer(e) ? hub.status() : null));
    handleHer('brain:models', (e, tier) => (fromHer(e) ? hub.listModels(String(tier)).catch((err) => ({ error: err.message })) : null));
    handleHer('brain:set', (e, patch) => (fromHer(e) ? hub.set(patch && typeof patch === 'object' ? patch : {}) : null));
    handleHer('brain:key', (e, key) => {
      if (!fromHer(e)) return null;
      try {
        if (key) hub.saveKey(String(key));
        else hub.clearKey();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    onHer('chat:send', (e, text) => { if (fromHer(e)) hub.send(String(text || '')); });
    onHer('chat:stop', (e) => { if (fromHer(e)) hub.stop(); });
    onHer('chat:reset', (e) => { if (fromHer(e)) hub.reset(); });
    // your click on her consent or question card (each id answers once)
    onHer('brain:answer', (e, a) => { if (fromHer(e) && a) hub.answer(String(a.id), String(a.value)); });
    onHer('computer:stop', (e) => { if (fromHer(e)) hub.stopComputer(); });
    // talking to her out loud: whisper.cpp on your machine (brain/voice-input.js)
    const voiceInput = createVoiceInput({ dataDir: paths.dataDir() });
    handleHer('voice:status', (e) => (fromHer(e) ? voiceInput.available() : null));
    handleHer('voice:transcribe', async (e, audio) => {
      if (!fromHer(e)) return null;
      try {
        return { text: await voiceInput.transcribe(audio) };
      } catch (err) {
        return { error: err.message };
      }
    });
    // the keyboard, while you type to her
    // (her window is made unfocusable, and Chromium drops keys for such a window: focusable only
    // while you type to her)
    handleHer('focus:take', async (e) => {
      if (!fromHer(e) || !x11 || !overlay?.xid) return false;
      overlay.win.setFocusable(true);
      const before = await x11.takeFocus(overlay.xid);
      if (before && before !== overlay.xid) focusBefore = before;
      return true;
    });
    onHer('focus:give', (e) => {
      if (!fromHer(e)) return;
      overlay?.win.setFocusable(false);
      if (x11 && focusBefore) x11.giveFocus(focusBefore);
      focusBefore = 0;
    });
    onHer('debug:state', (_e, { id, state }) => {
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
    // her hook scripts you installed, brought up to date with this version of her
    const refreshed = require('./hooks/files').refreshHookCopies(path.join(appDir, 'hooks'), paths.dataDir());
    if (refreshed.length) console.log(`[hexa] hook scripts updated: ${refreshed.join(', ')}`);

    // her brain: chat, her actions, computer use (brain/hub.js)
    hub = createHub({
      config, secrets: createSecrets(), send, shell, x11, bond,
      capture: createCapture({ desktopCapturer, getDisplay: () => overlay.display, cursor: () => screen.getCursorScreenPoint() }),
      // Escape (with any modifier: she may be holding one) is hers only while she has your mouse
      // and keyboard; no Escape, no task
      grabEscape: (stop) => {
        const keys = ['Escape', 'Shift+Escape', 'Control+Escape', 'Alt+Escape', 'Super+Escape'];
        const on = () => keys.filter((k) => globalShortcut.register(k, stop));
        const off = () => keys.forEach((k) => globalShortcut.unregister(k));
        if (!on().includes('Escape')) {
          off();
          return null;
        }
        return { pause: off, resume: on, done: off };
      },
      // her own card on screen (root pixels): never hers to click
      hersAt: ([x, y]) => {
        const d = overlay?.display;
        if (!d) return false;
        const cx = x / d.scaleFactor - d.bounds.x;
        const cy = y / d.scaleFactor - d.bounds.y;
        return lastHits.some(([rx, ry, rw, rh]) => cx >= rx && cy >= ry && cx < rx + rw && cy < ry + rh);
      },
      dataDir: paths.dataDir(),
      onReminder: (text) => {
        send('hexa:event', { hook_event_name: 'HexaReminder', text, demo: true });
        // in the background she can't come to you: a notification does
        if (config.load().visible === false) notifier.notify({ title: 'Hexa: reminder', body: text, actions: [{ id: 'show', label: 'Show' }] }).catch?.(() => {});
      },
      // music through MPRIS (her own watcher), else playerctl
      media: async (action) => {
        if (!mpris) return null;
        if (action === 'status') {
          const m = mpris.get();
          return m ? `${m.playing ? 'Playing' : 'Paused'}: ${[m.artist, m.title].filter(Boolean).join(' - ') || m.player}` : null;
        }
        const fn = { play_pause: 'playPause', next: 'next', previous: 'previous', stop: 'stop' }[action];
        if (!fn || !mpris.get()) return null;
        await mpris[fn]();
        return 'OK';
      },
      // the live checks' scripted Claude (dev mode only; tools/ isn't shipped)
      makeClaude: DEV && process.env.HEXA_FAKE_CLAUDE
        ? () => require(path.join(appDir, 'tools', 'live', 'fake-claude.js')).createFakeClaude(process.env.HEXA_FAKE_CLAUDE)
        : null,
    });

    // she feels her machine: CPU, memory, battery, heat (platform/linux/sense.js)
    startSense({ onTrouble: (t) => send('hexa:event', { hook_event_name: 'HexaSense', ...t, demo: true }) });

    overlay = createOverlay({
      preload: path.join(__dirname, '..', 'preload.js'),
      url: 'hexa://app/src/renderer/index.html',
      x11,
      displayId: cfg.displayId,
    });
    console.log(`[hexa] overlay on display ${overlay.display.id} (${overlay.display.bounds.width}×${overlay.display.bounds.height}), click-through by ${overlay.mode}`);
    // her page may use the microphone (only for talking to her: voice-input.js), nothing else
    overlay.win.webContents.session.setPermissionRequestHandler((wc, permission, allow, details) => {
      allow(wc === overlay.win.webContents && permission === 'media' && (details.mediaTypes || []).every((t) => t === 'audio'));
    });
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
          // Hook events only: her own (Hexa…) come from inside her, never over the socket, and
          // what main itself works out (the window, the demo flag) isn't taken from a sender
          if (/^Hexa/.test(evt.hook_event_name)) return;
          if (!DEV) delete evt.window_id;
          // the demo (npm run demo) plays like the real thing, but never counts
          if (!evt.demo) {
            if (evt.hook_event_name === 'Stop') bond.credit('task'); // a task she watched finish
            history.record(evt); // usage and history: counts only, never throws
          }
          // Claude needs you: she comes to the screen you're on first
          if (evt.hook_event_name === 'Notification' && ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(evt.notification_type)) {
            moveTo(pointerDisplay().id);
          }
          // Claude's window: the closest process up the hook's tree that owns one
          if (evt.ppid) {
            const win = windowForChain(parentChain(evt.ppid), lastWindows.wins);
            if (win) evt.window_id = win.id;
          }
          cliSessions.see(evt);
          notices.see(evt).catch(() => {}); // only while she's away
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
    startLinuxState(); // Do Not Disturb and music

    if (x11 && !(await x11.hasCompositor().catch(() => true))) {
      trayStatus = t().compositor;
      console.warn('[hexa] no compositing manager: her background will not be transparent');
    }

    const icon = nativeImage.createFromPath(path.join(appDir, 'assets', 'icons', 'tray.png'));
    trayHandle = createTray({ Tray, Menu, icon, getMenu: () => buildMenu(trayState(), t(), actions) });

    if (!globalShortcut.register(cfg.shortcut, actions.toggle)) console.warn(`[hexa] could not register ${cfg.shortcut}`);
    powerMonitor.on('resume', () => send('hexa:command', { name: 'resume' }));
    // back at the computer: once you're close, she's glad
    const back = () => {
      if (bond.stage().index >= 2) send('hexa:event', { hook_event_name: 'HexaBond', back: true, stage: bond.stage().name, index: bond.stage().index, demo: true });
    };
    powerMonitor.on('unlock-screen', back);
    powerMonitor.on('resume', back);
    overlay.win.webContents.on('did-finish-load', pushBond);

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
    history.flush(); // usage and history: the last few seconds of counts
    bond.flush();
    globalShortcut.unregisterAll();
    bridge?.close();
    windows?.stop();
    overlay?.destroy();
    x11?.close();
    dnd?.stop();
    mpris?.close();
    notifier.stop();
    sessionBus?.disconnect();
  });
  // the overlay is the only window; closing it must not quit while the tray lives
  app.on('window-all-closed', (e) => e.preventDefault?.());

  module.exports = { actions };
}
