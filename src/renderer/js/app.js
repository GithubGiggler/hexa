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
import { Viewport, contentBox } from './viewport.js';

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

// the display she lives on (her window is only a small part of it): asked for, not waited for,
// because the main process may have sent it before this page was listening
const startArea = await host.getArea();
let area = { x: startArea.x, y: startArea.y, w: startArea.w, h: startArea.h };
const hexa = new Hexa({
  rig, player, fx, voice, area, scale: cfg.scale, now: () => performance.now(),
  settings: { wander: cfg.wander, motion: cfg.motion, reducedMotion: cfg.reducedMotion },
});
const panel = new Panel({ root: ui, voice, glyphs: pack.glyphs, palette: pack.palette });
const brain = new Brain({ hexa, panel, voice, lang: cfg.lang || 'en' });
brain.linked = cfg.linked;
brain.watching = cfg.claude;
brain.onLinked = () => host.setConfig({ linked: true });

// her emblem follows the ticker: amber while Claude thinks, magenta while it waits on you, red on errors
const setTicker = panel.setTicker.bind(panel);
panel.setTicker = (t) => {
  hexa.emblemState = t && t.state !== 'work' ? t.state : null;
  setTicker(t);
};

const lines = () => linesFor(cfg.lang || 'en');
const vars = { name: 'Claude', user: 'there' };
hexa.onSay = (key) => {
  const t = lines();
  if (!t[key]) return;
  let line = fmt(pick(t[key]), vars);
  if (key === 'boot') line = `${line} ${fmt(pick(t.online), vars)}`;
  panel.say({ kind: 'info', line, face: FACES[key] || 'calm', hold: key === 'boot' ? 5000 : 3200 });
};

// ---- the screen, and her window on it ----
// She lives in a small window that follows her (not a full-screen layer). Everything is computed in
// the display's coordinates; vp is the part of the display her window shows right now.

const BODY_MARGIN = 80; // room around her body for her hair, her glow and the shards she sheds
let vp = null;
let origin = { x: startArea.originX || 0, y: startArea.originY || 0 };
const viewport = new Viewport({ slack: 90 });

function fit(a) {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  if (a) {
    area = { x: a.x, y: a.y, w: a.w, h: a.h };
    origin = { x: a.originX || 0, y: a.originY || 0 };
    hexa.setArea(area);
  }
}
fit();
addEventListener('resize', () => fit());
host.onArea((a) => fit(a));
function applyViewport(r) {
  vp = r;
  viewport.applied(r);
  ui.style.transform = `translate(${-r[0]}px, ${-r[1]}px)`;
}
host.onViewport(applyViewport);
host.getViewport().then((r) => !vp && r && applyViewport(r));

// a pointer event, in display coordinates (screen coordinates don't move when her window does)
const world = (e) => ({ x: e.screenX - origin.x, y: e.screenY - origin.y });

// ---- from the main process ----

host.onEvent((evt) => {
  if (evt.hook_event_name === 'HexaShowcase') return showcase();
  return brain.handle(evt);
});

host.onCommand(({ name }) => {
  if (name === 'background') hexa.toggleBackground();
  else if (name === 'teleport') hexa.teleport();
  else if (name === 'resume') brain.resume();
  else if (name === 'showcase') showcase();
});

host.onConfig((c) => {
  cfg = c;
  voice.setMuted(c.muted);
  voice.setVolume(c.volume);
  hexa.setScale(c.scale);
  hexa.setSettings({ wander: c.wander, motion: c.motion, reducedMotion: c.reducedMotion });
  brain.watching = c.claude;
});

host.onPointer((p) => hexa.onPointer(p));

// everything in display coordinates, like the hit rects sent to the main process
host.answerState(() => ({
  mode: hexa.mode,
  pos: hexa.pos,
  viewport: vp,
  hitRects: [...hexa.hitRects(), ...(vp ? panel.rects().map(([x, y, w, h]) => [x + vp[0], y + vp[1], w, h]) : [])],
}));

// ---- the mouse, on her ----

let press = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { ...world(e), t: performance.now(), dragging: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  const p = world(e);
  if (!press.dragging && (Math.hypot(p.x - press.x, p.y - press.y) > CLICK_PX || performance.now() - press.t > CLICK_MS)) {
    press.dragging = hexa.onDragStart(press);
    if (!press.dragging) press = null;
  }
  if (press?.dragging) hexa.onDragMove(p);
});
canvas.addEventListener('pointerup', (e) => {
  if (!press) return;
  const p = world(e);
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

  if (vp) {
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, -vp[0] * dpr, -vp[1] * dpr);
    ctx.clearRect(vp[0], vp[1], vp[2], vp[3]);
    fx.draw(ctx);
    hexa.draw(ctx);
  }

  const body = hexa.hitRects();
  const bodyBox = contentBox(body, 0);
  if (bodyBox) panel.anchor(bodyBox, area);
  // the panel's DOM rects are relative to her window; back to display coordinates
  const panelRects = vp ? panel.rects().map(([x, y, w, h]) => [x + vp[0], y + vp[1], w, h]) : [];

  // her window follows what she draws: her body (with room for her hair), her panel, live effects
  const needed = [bodyBox && contentBox([bodyBox], BODY_MARGIN * hexa.scale), ...panelRects, fx.bounds()].filter(Boolean);
  const want = viewport.want(contentBox(needed, 0), now);
  if (want) host.setViewport(want);

  if (now - lastHits >= HIT_EVERY_MS) {
    lastHits = now;
    const rects = [...body, ...panelRects].map((r) => r.map((v) => Math.round(v)));
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
    setTimeout(() => {
      panel.say({ kind: 'info', line: 'Right-click me for my menu. "Install Claude Code hooks" plugs me into Claude.', face: 'smug', hold: 9000 });
      host.setConfig({ welcomed: true });
    }, 6500);
  }
}
