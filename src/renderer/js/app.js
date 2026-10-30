// The overlay page: builds Hexa from her pack, connects her to the main process (window.host),
// and runs the frame loop. Everything she does is decided in hexa.js and brain.js; this file
// only wires them up and turns mouse input into her drag, click and menu.

import { loadPack } from './character/pack.js';
import { buildRig } from './character/rig.js';
import { Player } from './character/acting.js';
import { Fx } from './fx.js';
import { Hexa } from './hexa.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { linesFor, greetingKey } from './lines/index.js';
import { pick, fmt } from './util.js';
import { Guide } from './guide.js';
import { Menu } from './menu.js';
import { Hud, sessionRows } from './hud.js';
import { Mainframe, TaskCard } from './mainframe.js';

const host = window.host;
const HIT_EVERY_MS = 33;
const CLICK_PX = 4;
const CLICK_MS = 250;
const FACES = {
  boot: 'laugh', dragged: 'wide', dropped: 'smug', landed: 'dizzy', peekShy: 'wide', zap: 'smug',
  sleepy: 'sleepy', wake: 'wide', background: 'calm', back: 'laugh',
};

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const ui = document.getElementById('ui');

let cfg = await host.getConfig();
// her language, resolved by the main process; on the page too, so Japanese gets Japanese glyphs
document.documentElement.lang = cfg.lang || 'en';
const pack = await loadPack(cfg.packUrl);
const rig = buildRig(pack);
const player = new Player();
const fx = new Fx({ palette: pack.palette });
const voice = new Voice({ volume: cfg.volume, muted: cfg.muted });
host.listSounds().then((files) => voice.loadCustom(files)).catch(() => {});

// the display's work area (without your panels), asked for at startup: the push the main process
// sends on load can arrive before this page is listening
const startArea = await host.getArea();
let area = { x: startArea.x, y: startArea.y, w: startArea.w, h: startArea.h };
const hexa = new Hexa({
  rig, player, fx, voice, area, scale: cfg.scale, now: () => performance.now(),
  settings: { wander: cfg.wander, possess: cfg.possess, motion: cfg.motion, reducedMotion: cfg.reducedMotion },
});
const panel = new Panel({ root: ui, voice, glyphs: pack.glyphs, palette: pack.palette });
const menu = new Menu({ root: ui, onPick: (id) => host.menuPick(id), onClose: () => host.menuClosed() });
let menuAt = { x: 0, y: 0 };
const hud = new Hud({ root: ui, onPick: (id) => brain.focusSession(id) });
const mainframe = new Mainframe({ root: ui, host });
const taskCard = new TaskCard({ root: ui });
host.onChat((e) => mainframe.onChat(e));
// her consent card before she touches your computer, and her questions while she does: your
// click on the card answers (the panel's buttons take only real clicks)
let askingNow = false; // her question mid-task is up: the one thing of hers you can click then
host.onBrainAsk((q) => {
  const consent = q.kind === 'consent';
  const b = lines().buttons;
  if (!consent) askingNow = true;
  panel.say({
    kind: 'alert', face: 'wide', hold: null, guarded: true,
    line: consent ? b.consent : q.question,
    quote: consent ? q.task : '',
    // (what's sent back to her model stays in English: it's for the model, not you)
    actions: consent ? [{ id: 'start', label: b.start, primary: true }, { id: 'cancel', label: b.cancel }] : [{ id: 'Yes, go ahead.', label: b.yes, primary: true }, { id: 'No, don\'t.', label: b.no }],
    onAction: (value) => { askingNow = false; host.brainAnswer(q.id, value); },
    onDismiss: () => { askingNow = false; host.brainAnswer(q.id, consent ? 'cancel' : 'No, don\'t.'); },
  });
  if (consent) voice.play('alert');
});
host.onBrainGone(() => { askingNow = false; panel.clearKind('alert'); });
let computerRunning = false;
let keysSeen = 0; // for her debug state
addEventListener('keydown', () => { keysSeen++; }, true);
host.onComputerStart(({ task }) => {
  computerRunning = true;
  mainframe.close();
  taskCard.start(task);
  // out of your way: into the corner, working
  hexa.teleport({ x: area.x + hexa.size.w * 0.7, y: area.y + area.h }, () => hexa.setMode('work'));
});
host.onComputerStep((step) => taskCard.step(step));
host.onComputerEnd((out) => {
  computerRunning = false;
  taskCard.end(out);
  hexa.setMode('idle');
  const line = out.outcome === 'stopped' ? 'Stopped. I let go of everything.' : out.text || 'Done.';
  panel.say({ kind: out.outcome === 'done' ? 'done' : 'info', line, face: out.outcome === 'done' ? 'laugh' : 'calm', hold: 7000 });
});
host.onMenu(({ items }) => menu.show(items, menuAt, area, { x: 0, y: 0, w: innerWidth, h: innerHeight }));
host.onMenuKey((key) => menu.key(key));
// cfg.assistant: whose work she follows ('claude', 'codex' or 'agy'; her menu's Watch)
const brain = new Brain({ hexa, panel, voice, lang: cfg.lang || 'en', assistant: cfg.assistant || 'claude' });
brain.answerPermission = (id, choice) => host.answerPermission(id, choice);
host.onPermission((card) => brain.onPermissionAsk(card));
host.onPermissionGone(({ id }) => brain.onPermissionGone(id));
brain.linked = cfg.linked;
brain.watching = cfg.claude;
brain.onLinked = () => host.setConfig({ linked: true });

// a click on her core brings her back: the main process keeps her setting and her tray in step
hexa.onBackground = (inBackground) => host.setConfig({ visible: !inBackground });

// her emblem follows the ticker: amber while Claude thinks, magenta while it waits on you, red on errors
const setTicker = panel.setTicker.bind(panel);
panel.setTicker = (t) => {
  hexa.emblemState = t && t.state !== 'work' ? t.state : null;
  setTicker(t);
};

const lines = () => linesFor(cfg.lang || 'en');
const guide = new Guide({ hexa, panel, host, brain, lines });
const vars = { name: brain.name, user: 'there' };
hexa.onSay = (key) => {
  const t = lines();
  if (!t[key]) return;
  let line = fmt(pick(t[key]), vars);
  if (key === 'boot') line = `${line} ${fmt(pick(t.online), vars)} ${pick(t[greetingKey(new Date().getHours())])}`;
  panel.say({ kind: 'info', line, face: FACES[key] || 'calm', hold: key === 'boot' ? 5000 : 3200 });
};

// ---- the screen ----

function fit(a) {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (a) {
    area = { x: a.x, y: a.y, w: a.w, h: a.h };
    hexa.setArea(area);
  }
}
fit();
addEventListener('resize', () => fit());
host.onArea((a) => fit(a));

// ---- from the main process ----

host.onEvent((evt) => {
  if (evt.hook_event_name === 'HexaShowcase') return showcase();
  // the hexa CLI: `hexa say`, `hexa react`, `hexa run -- <command>`
  if (evt.hook_event_name === 'HexaSay') {
    hexa.attend();
    panel.say({ kind: 'info', line: String(evt.text || ''), face: evt.face || 'calm', hold: 5000 });
    return undefined;
  }
  if (evt.hook_event_name === 'HexaReact') {
    const r = evt.reaction;
    if (r === 'done') hexa.celebrate('');
    else if (r === 'error') { hexa.knockback(); voice.play('error'); }
    else if (r === 'alert') { hexa.comeToPointer(); voice.play('alert'); }
    else if (r === 'hello') { hexa.perform('wave'); hexa.onSay('hello'); }
    else if (r === 'fork') hexa.fork();
    return undefined;
  }
  if (evt.hook_event_name === 'HexaRun') {
    const command = String(evt.command || '');
    if (evt.phase === 'start') {
      hexa.attend();
      hexa.setMode('work');
      panel.setTicker({ verb: 'RUNS', target: command.length > 40 ? `${command.slice(0, 39)}…` : command, state: 'work' });
      return undefined;
    }
    panel.setTicker(null);
    hexa.setMode('idle');
    const secs = Math.round((evt.duration_ms || 0) / 1000);
    if (evt.ok) {
      voice.play('done');
      hexa.perform('hop');
      panel.say({ kind: 'done', line: `exit 0. ${command} took ${secs} s.`, face: 'smug', hold: 5000 });
    } else {
      hexa.knockback();
      voice.play('error');
      panel.say({ kind: 'error', line: evt.signal ? `${command} was stopped (${evt.signal}).` : `${command} exited with ${evt.code}.`, face: 'dead', hold: 7000 });
    }
    return undefined;
  }
  // your bond: a new stage (her forks come out to see you), or you're back
  if (evt.hook_event_name === 'HexaBond') {
    const t = lines();
    if (evt.up) {
      hexa.fork();
      panel.say({ kind: 'done', line: fmt(pick(t.bondUp), { ...vars, stage: evt.stage }), face: 'laugh', hold: 7000 });
    } else if (evt.back && !linux.dnd) {
      hexa.wake();
      panel.say({ kind: 'info', line: pick(t.welcomeBack), face: 'smug', hold: 4000 });
    }
    return undefined;
  }
  // her machine in trouble (main: sense.js); quiet under Do Not Disturb
  if (evt.hook_event_name === 'HexaSense') {
    if (linux.dnd) return undefined;
    const key = { cpu: 'senseCpu', memory: 'senseMemory', battery: 'senseBattery', hot: 'senseHot' }[evt.kind];
    const n = evt.load ?? evt.free ?? evt.percent ?? evt.temp;
    const t = lines();
    if (key && t[key]) {
      hexa.attend();
      panel.say({ kind: 'info', line: fmt(pick(t[key]), { ...vars, n }), face: evt.kind === 'hot' || evt.kind === 'battery' ? 'wide' : 'squint', hold: 6000 });
    }
    return undefined;
  }
  if (evt.hook_event_name === 'HexaReminder') {
    hexa.comeToPointer();
    voice.play('alert');
    panel.say({ kind: 'alert', line: String(evt.text || ''), tag: 'reminder', face: 'wide', hold: 12000 });
    return undefined;
  }
  return brain.handle(evt);
});

host.onCommand(({ name, on }) => {
  if (name === 'background') hexa.setBackground(on ?? hexa.mode !== 'background');
  else if (name === 'teleport') hexa.teleport();
  else if (name === 'lurk') { if (!hexa.lurk()) hexa.onSay('noLurk'); }
  else if (name === 'fork') hexa.fork();
  else if (name === 'mainframe') mainframe.toggle();
  else if (name === 'resume') brain.resume();
  else if (name === 'showcase') showcase();
  else if (name === 'guide') guide.menu();
  else if (name === 'arrive') hexa.arrive();
});

// Do Not Disturb and music, from the desktop (main: dnd.js, mpris.js)
let linux = { dnd: false, music: null };
const applySettings = () => {
  voice.setMuted(cfg.muted || linux.dnd);
  // with Do Not Disturb on: no wandering off, no taking over windows
  hexa.setSettings({ wander: cfg.wander && !linux.dnd, possess: cfg.possess && !linux.dnd, motion: cfg.motion, reducedMotion: cfg.reducedMotion });
  brain.quiet = linux.dnd;
};
// how close you two are (main: bond.js)
let bondState = { index: 0, name: 'Unknown host' };
host.onBond((b) => { bondState = b || bondState; });
const AI_NAMES = { chatgpt: 'ChatGPT', gemini: 'Gemini', copilot: 'Copilot', perplexity: 'Perplexity', deepseek: 'DeepSeek', grok: 'Grok', lechat: 'Le Chat', characterai: 'Character.AI', metaai: 'Meta AI', codex: 'Codex', claude: 'Claude' };
// another AI in front for a while: once you're close (Trusted), she goes and sits on it, glaring
brain.onJealous = (key) => {
  const t = lines();
  const ai = AI_NAMES[key] || key;
  if (bondState.index >= 3) {
    const seat = hexa.pickSeat({ frontOnly: true });
    if (seat) hexa.sitOn(seat);
    panel.say({ kind: 'info', line: fmt(pick(t.jealousAngry), { ...vars, ai }), face: 'angry', hold: 5000 });
  } else {
    panel.say({ kind: 'info', line: fmt(pick(t.jealousNotice), { ...vars, ai }), face: 'squint', hold: 4000 });
  }
};

host.onLinuxState((state) => {
  linux = { dnd: Boolean(state?.dnd), music: state?.music || null };
  applySettings();
  hexa.setMusic(Boolean(linux.music?.playing));
});

host.onConfig((c) => {
  cfg = c;
  brain.lang = c.lang || 'en';
  document.documentElement.lang = brain.lang;
  voice.setVolume(c.volume);
  hexa.setScale(c.scale);
  applySettings();
  brain.watching = c.claude;
  brain.jealousOn = c.jealous !== false;
  brain.watch(c.assistant || 'claude');
  vars.name = brain.name;
});

host.onPointer((p) => hexa.onPointer(p));

// where your windows are (front first), for sitting on them and knowing which one is Claude's
host.onWindows((snap) => {
  hexa.setWindows(snap);
  brain.onWindows(snap);
});

host.answerState(() => ({
  mode: hexa.mode,
  pos: hexa.pos,
  perch: hexa.perch,
  pointing: hexa.pointing ? { id: hexa.pointing.rect.id ?? null, label: hexa.pointing.label } : null,
  hitRects: [...hexa.hitRects(), ...panel.rects()],
  menu: menu.open,
  menuLabels: menu.open ? menu.levels[0].items.map((i) => (i.type === 'separator' || i.enabled === false ? null : i.label)) : [],
  hud: hud.rects(),
  forks: hexa.forks.length,
  buttons: panel.buttonRects(),
  mainframe: mainframe.open,
  said: panel.current ? panel.current.line : '',
  ticker: panel.tickerState ? `${panel.tickerState.verb} ${panel.tickerState.target}` : '',
  chat: mainframe.log.textContent.slice(-300),
  task: taskCard.box.hidden ? '' : taskCard.box.textContent,
  typing: { hasFocus: document.hasFocus(), active: document.activeElement?.className || '', value: mainframe.input.value, keys: keysSeen },
}));

// ---- the mouse, on her ----

let press = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.clientX, y: e.clientY, t: performance.now(), dragging: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  const p = { x: e.clientX, y: e.clientY };
  if (!press.dragging && (Math.hypot(p.x - press.x, p.y - press.y) > CLICK_PX || performance.now() - press.t > CLICK_MS)) {
    press.dragging = hexa.onDragStart(press);
    if (!press.dragging) press = null;
  }
  if (press?.dragging) hexa.onDragMove(p);
});
canvas.addEventListener('pointerup', (e) => {
  if (!press) return;
  const p = { x: e.clientX, y: e.clientY };
  if (press.dragging) hexa.onDragEnd(p);
  else if (Math.hypot(p.x - press.x, p.y - press.y) <= CLICK_PX && performance.now() - press.t <= CLICK_MS) {
    if (hexa.onClick() === 'status') panel.say({ kind: 'info', line: brain.status(), face: 'smug', hold: 4500 });
  }
  press = null;
});
addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (menu.open) return;
  menuAt = { x: e.clientX, y: e.clientY };
  host.openMenu();
});

// ---- the demo's second half: her tricks, a line before each ----

let showing = false;
async function showcase() {
  if (showing) return;
  showing = true;
  hexa.setSettings({ wander: false }); // no drifting off in the middle of a trick
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tell = (line, face = 'smug') => panel.say({ kind: 'info', line, face, hold: 2600 });
  try {
    tell('Now my own tricks. First: your pointer.');
    await wait(1800);
    hexa.zap({ x: area.x + area.w / 2, y: area.y + area.h * 0.4 });
    await wait(2600);
    tell('I like to peek.', 'ask');
    hexa.peek();
    await wait(4200);
    tell('Gravity, watch.', 'wide');
    hexa.drop();
    await wait(3200);
    tell('When nothing happens for a while, I sleep.', 'sleepy');
    hexa.sleepNow();
    await wait(3500);
    hexa.suspendNow();
    await wait(3500);
    hexa.wake();
    await wait(1500);
    tell('Ctrl+Alt+H sends me to the background.', 'calm');
    await wait(1800);
    hexa.toggleBackground();
    await wait(3000);
    hexa.toggleBackground();
    await wait(1500);
    tell('That\'s me. Right-click me for my menu.', 'laugh');
  } finally {
    showing = false;
    hexa.setSettings({ wander: cfg.wander });
  }
}

// ---- the loop ----

let last = performance.now();
let lastHits = 0;
let sentHits = '';
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  hexa.update(dt);
  fx.update(dt);
  panel.update();

  ctx.clearRect(0, 0, innerWidth, innerHeight);
  fx.draw(ctx);
  hexa.draw(ctx);

  const body = hexa.hitRects();
  if (body.length) {
    const x0 = Math.min(...body.map((r) => r[0]));
    const y0 = Math.min(...body.map((r) => r[1]));
    const x1 = Math.max(...body.map((r) => r[0] + r[2]));
    const y1 = Math.max(...body.map((r) => r[1] + r[3]));
    panel.anchor([x0, y0, x1 - x0, y1 - y0], area);
  }
  if (now - lastHits >= HIT_EVERY_MS) {
    lastHits = now;
    // while she uses your computer, every click goes through (she must never catch one)
    const rects = (computerRunning ? (askingNow ? panel.rects() : []) : [...body, ...panel.rects(), ...hud.rects(), ...mainframe.rects(), ...menu.rects()]).map((r) => r.map((v) => Math.round(v)));
    const key = JSON.stringify(rects);
    if (key !== sentHits) {
      sentHits = key;
      host.setHitRects(rects);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => {
  brain.tick();
  hud.update(sessionRows(brain.sessions.values(), Date.now()));
}, 1000);

// ---- first light ----

if (!cfg.visible) {
  hexa.toggleBackground();
} else {
  hexa.boot();
  if (!cfg.welcomed) {
    // her welcome, the first time: who she is, and plugging her into Claude in one click
    setTimeout(() => {
      host.setConfig({ welcomed: true });
      guide.welcome();
    }, 6500);
  }
}
