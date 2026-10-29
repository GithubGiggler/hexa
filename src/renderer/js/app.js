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
import { linesFor } from './lines/index.js';
import { pick, fmt } from './util.js';
import { Guide } from './guide.js';

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
const brain = new Brain({ hexa, panel, voice, lang: cfg.lang || 'en' });
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
const vars = { name: 'Claude', user: 'there' };
hexa.onSay = (key) => {
  const t = lines();
  if (!t[key]) return;
  let line = fmt(pick(t[key]), vars);
  if (key === 'boot') line = `${line} ${fmt(pick(t.online), vars)}`;
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
  return brain.handle(evt);
});

host.onCommand(({ name, on }) => {
  if (name === 'background') hexa.setBackground(on ?? hexa.mode !== 'background');
  else if (name === 'teleport') hexa.teleport();
  else if (name === 'resume') brain.resume();
  else if (name === 'showcase') showcase();
  else if (name === 'guide') guide.menu();
  else if (name === 'arrive') hexa.arrive();
});

host.onConfig((c) => {
  cfg = c;
  voice.setMuted(c.muted);
  voice.setVolume(c.volume);
  hexa.setScale(c.scale);
  hexa.setSettings({ wander: c.wander, possess: c.possess, motion: c.motion, reducedMotion: c.reducedMotion });
  brain.watching = c.claude;
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
    const rects = [...body, ...panel.rects()].map((r) => r.map((v) => Math.round(v)));
    const key = JSON.stringify(rects);
    if (key !== sentHits) {
      sentHits = key;
      host.setHitRects(rects);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => brain.tick(), 1000);

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
