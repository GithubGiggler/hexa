import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Hexa } from '../src/renderer/js/hexa.js';
import { buildRig } from '../src/renderer/js/character/rig.js';
import { Player } from '../src/renderer/js/character/acting.js';

const pack = JSON.parse(fs.readFileSync(new URL('../packs/hexa/pack.json', import.meta.url), 'utf8'));
const AREA = { x: 0, y: 30, w: 2560, h: 1410 };

function make(settings = {}) {
  let t = 0;
  const played = [];
  const player = new Player();
  const play = player.play.bind(player);
  player.play = (name, opts) => { played.push(name); return play(name, opts); };
  const fxCalls = [];
  // records every effect asked for; possess hands back its { leave } like the real Fx does
  const fx = new Proxy({ impactKind: () => null, glitching: () => 0 }, { get: (o, k) => (k in o ? o[k] : (...a) => { fxCalls.push([k, ...a]); return k === 'possess' ? { leave() {} } : undefined; }) });
  const sounds = [];
  const said = [];
  const h = new Hexa({
    rig: buildRig(pack), player, fx, voice: { play: (n) => sounds.push(n) }, area: { ...AREA },
    rand: () => 0.99, now: () => t, settings: { wander: false, motion: 'full', ...settings },
  });
  h.onSay = (key) => said.push(key);
  const advance = (seconds, step = 0.05) => {
    for (let s = 0; s < seconds - 1e-9; s += step) {
      t += step * 1000;
      h.update(step);
    }
  };
  const jump = (ms) => { t += ms; };
  return { h, played, fxCalls, sounds, said, advance, jump, player };
}

const floor = AREA.y + AREA.h;
const TELEPORT_S = 2.4; // a whole teleport: vanishing, the trip as an orb (0.9 s at most), arriving

test('she starts idle at her rest spot', () => {
  const { h } = make();
  assert.equal(h.mode, 'idle');
  assert.ok(h.pos.x > AREA.w / 2 && h.pos.y > AREA.h / 2);
});

test('sleeps after 10 quiet minutes, suspends 60 s later', () => {
  const { h, played, advance, said } = make();
  advance(599, 1);
  assert.equal(h.mode, 'idle');
  advance(3, 1);
  advance(2);
  assert.equal(h.mode, 'sleep');
  assert.ok(played.includes('yawn'));
  assert.ok(said.includes('sleepy'));
  advance(61, 1);
  advance(1);
  assert.equal(h.mode, 'suspend');
});

test('pointer near wakes her from suspend', () => {
  const { h, advance } = make();
  advance(700, 1);
  advance(1);
  assert.equal(h.mode, 'suspend');
  const [x, y, w, hh] = h.hitRects()[0];
  h.onPointer({ x: x + w / 2 + 40, y: y + hh / 2, inside: false });
  advance(1);
  assert.equal(h.mode, 'idle');
});

test('Claude waking her up works from sleep too', () => {
  const { h, advance } = make();
  advance(610, 1);
  advance(1);
  assert.equal(h.mode, 'sleep');
  h.wake();
  advance(1);
  assert.equal(h.mode, 'idle');
});

test('drag release above the floor falls, lands, then idles', () => {
  const { h, played, advance, said } = make();
  const grab = { x: h.pos.x, y: h.pos.y - 120 };
  assert.equal(h.onDragStart(grab), true);
  assert.equal(h.mode, 'drag');
  h.onDragMove({ x: 900, y: 400 });
  h.onDragEnd({ x: 900, y: 400 });
  assert.equal(h.mode, 'fall');
  advance(2);
  assert.equal(h.pos.y, floor);
  assert.ok(played.includes('land'));
  assert.equal(h.mode, 'idle');
  assert.ok(said.includes('landed'));
});

test('a drag start away from her body is not hers', () => {
  const { h } = make();
  assert.equal(h.onDragStart({ x: 10, y: 10 }), false);
  assert.equal(h.mode, 'idle');
});

test('comeToPointer stays 50 to 80 px beside the pointer', () => {
  const { h, advance } = make();
  h.onPointer({ x: 1200, y: 700, inside: false });
  h.comeToPointer();
  assert.equal(h.alerting, true); // teleporting over to you counts
  advance(2.5);
  assert.equal(h.mode, 'alert');
  const dx = Math.abs(h.pos.x - 1200);
  assert.ok(dx >= 50 && dx <= 80, `dx ${dx}`);
  h.onPointer({ x: 1260, y: 720, inside: false });
  advance(TELEPORT_S);
  const dx2 = Math.abs(h.pos.x - 1260);
  assert.ok(dx2 >= 50 && dx2 <= 80, `follows: dx ${dx2}`);
});

test('background: hit rects are only the core, bottom-left', () => {
  const { h, advance, said } = make();
  h.toggleBackground();
  advance(1);
  assert.equal(h.mode, 'background');
  const rects = h.hitRects();
  assert.equal(rects.length, 1);
  const [x, y] = rects[0];
  assert.ok(x < AREA.x + 120 && y > floor - 120);
  assert.ok(said.includes('background'));
  // clicking the core brings her back
  assert.equal(h.onClick(), null);
  advance(1);
  assert.notEqual(h.mode, 'background');
});

test('background core opens its eyes when Claude needs you, without moving', () => {
  const { h, advance } = make();
  h.toggleBackground();
  advance(1);
  const before = h.hitRects()[0];
  h.comeToPointer();
  advance(1);
  assert.equal(h.mode, 'background');
  assert.deepEqual(h.hitRects()[0], before);
  assert.equal(h.coreAlert, true);
});

test('setArea after a monitor change re-clamps her', () => {
  const { h, advance } = make();
  h.setArea({ x: 0, y: 0, w: 1920, h: 1080 });
  advance(0.1);
  for (const [x, y, w, hh] of h.hitRects()) {
    assert.ok(x + w <= 1920 + 60, 'inside the new width (hair may stick out a little)');
    assert.ok(y + hh <= 1080 + 20);
  }
  assert.ok(h.pos.x <= 1920 && h.pos.y <= 1080);
});

test('reduced motion: teleport is a fade, not teleportOut', () => {
  const { h, played, advance } = make({ motion: 'reduced' });
  h.teleport({ x: 400, y: 900 });
  advance(0.1);
  assert.ok(h.alpha < 1);
  advance(0.6);
  assert.ok(!played.includes('teleportOut'));
  assert.deepEqual(h.pos, { x: 400, y: 900 });
  assert.equal(h.alpha, 1);
});

test('full motion teleport shatters, leaves a slit, and arrives', () => {
  const { h, played, fxCalls, advance } = make();
  h.teleport({ x: 400, y: 900 });
  advance(TELEPORT_S);
  assert.ok(played.includes('teleportOut') && played.includes('teleportIn'));
  assert.ok(fxCalls.some((c) => c[0] === 'slit'));
  assert.ok(fxCalls.some((c) => c[0] === 'shards'));
  assert.deepEqual(h.pos, { x: 400, y: 900 });
});

// how long a full-motion teleport takes, in seconds, to the nearest 50 ms
function tripTime(dx) {
  const { h, advance } = make();
  h.teleport({ x: h.pos.x + dx, y: h.pos.y });
  let t = 0;
  while (h.mode === 'teleport' && t < 5) { advance(0.05); t += 0.05; }
  return t;
}

test('between vanishing and arriving she travels as an orb, and lands inside rings', () => {
  const { h, fxCalls, advance } = make();
  const from = h.body();
  h.teleport({ x: 400, y: 900 });
  advance(2);
  const orb = fxCalls.find((c) => c[0] === 'orb');
  assert.ok(orb, 'an orb');
  assert.ok(Math.hypot(orb[1].x - from.x, orb[1].y - from.y) < 1, 'from where she was');
  const landed = h.body();
  assert.ok(Math.hypot(orb[2].x - landed.x, orb[2].y - landed.y) < 1, 'to where she lands');
  assert.ok(fxCalls.some((c) => c[0] === 'rings'));
});

test('a farther teleport is a longer trip, but never past the watchdog', () => {
  const near = tripTime(-150);
  const far = tripTime(-2000);
  assert.ok(far > near + 0.2, `near ${near} s, far ${far} s`);
  assert.ok(far < 2.4, `far ${far} s`);
});

test('celebrate plays exit 0 with its effects, then resolves back to idle', async () => {
  const { h, played, fxCalls, advance } = make();
  let done = false;
  const p = h.celebrate('3 actions').then(() => { done = true; });
  advance(6);
  await p;
  assert.equal(done, true);
  assert.ok(played.includes('exit0'));
  assert.ok(fxCalls.some((c) => c[0] === 'shockwave'));
  assert.ok(fxCalls.some((c) => c[0] === 'speedLines'));
  assert.equal(h.mode, 'idle');
});

test('knockback plays the segfault with an impact frame', () => {
  const { h, played, fxCalls, advance } = make();
  h.knockback();
  advance(0.2);
  assert.ok(played.includes('segfault'));
  assert.ok(fxCalls.some((c) => c[0] === 'impact' && c[1] === 'red'));
});

test('a click on her says her status; a click in suspend wakes her', () => {
  const { h, advance } = make();
  assert.equal(h.onClick(), 'status');
  advance(700, 1);
  advance(1);
  assert.equal(h.onClick(), null);
  advance(1);
  assert.equal(h.mode, 'idle');
});

test('work mode shows the work stance; the emblem follows her state', () => {
  const { h, player, advance } = make();
  h.setMode('work');
  advance(0.1);
  assert.equal(player.stanceName, 'work');
  h.emblemState = 'thinking';
  assert.equal(h.look().emblem, pack.palette.amber);
  h.emblemState = 'waiting';
  assert.equal(h.look().emblem, pack.palette.magenta);
});

test('boot assembles her and ends idle with the boot line', () => {
  const { h, said, fxCalls, sounds, advance } = make();
  h.boot();
  assert.equal(h.mode, 'boot');
  advance(6);
  assert.equal(h.mode, 'idle');
  assert.ok(said.includes('boot'));
  assert.ok(fxCalls.some((c) => c[0] === 'assemble'));
  assert.ok(sounds.includes('boot'));
});

test('an alert answered while she is still teleporting over does not leave her chasing the pointer', () => {
  const { h, advance } = make();
  h.onPointer({ x: 400, y: 600, inside: false }); // far from her rest spot: she teleports
  h.comeToPointer();
  advance(0.2);
  assert.equal(h.mode, 'teleport');
  h.setMode('work'); // Claude moved on: the prompt was answered
  advance(2);
  assert.equal(h.mode, 'work');
  assert.equal(h.alerting, false);
});

test('drop() lifts her up and lets her fall onto the floor', () => {
  const { h, advance } = make();
  h.drop();
  assert.equal(h.mode, 'fall');
  assert.ok(h.pos.y < floor - 200);
  advance(3);
  assert.equal(h.pos.y, floor);
  assert.equal(h.mode, 'idle');
});

test('sleepNow() and suspendNow() skip the waiting (for the demo)', () => {
  const { h, advance } = make();
  h.sleepNow();
  advance(0.1);
  assert.equal(h.mode, 'sleep');
  h.suspendNow();
  advance(2);
  assert.equal(h.mode, 'suspend');
  assert.equal(h.hitRects().length, 1, 'just her core');
});

test('a zap asked for while she teleports does not leave her stuck teleporting', () => {
  const { h, advance } = make();
  h.teleport({ x: 600, y: 900 });
  advance(0.1);
  h.zap({ x: 700, y: 700 });
  advance(2);
  assert.notEqual(h.mode, 'teleport');
  assert.deepEqual(h.pos, { x: 600, y: 900 });
});

test('a teleport whose animation gets cut off still arrives', () => {
  const { h, player, advance } = make();
  h.teleport({ x: 600, y: 900 });
  advance(0.1);
  player.play('hop'); // something replaced teleportOut before it ended
  advance(4);
  assert.notEqual(h.mode, 'teleport');
  assert.deepEqual(h.pos, { x: 600, y: 900 });
  assert.equal(h.hidden, false);
  assert.equal(h.alpha, 1);
});

// ---- windows (M2): sitting and riding, rules ported from upstream v0.4.3 ----

const konsole = (extra = {}) => ({ id: 5, x: 400, y: 600, w: 900, h: 500, max: false, ...extra });

test('she lurks behind the window in front: head and shoulders over its top edge, nothing below it', () => {
  const { h, player, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  assert.equal(h.lurk(), true);
  advance(TELEPORT_S);
  assert.deepEqual({ id: h.perch?.id, behind: h.perch?.behind }, { id: 5, behind: true });
  assert.equal(h.mode, 'idle');
  assert.equal(player.stanceName, 'lurk');
  assert.ok(h.pos.y > 600, 'her feet are hidden behind the window');
  assert.ok(h.pos.y - h.size.h < 600 - 40, 'her head shows over the edge');
  const rects = h.hitRects();
  assert.ok(rects.length > 0);
  for (const [, y, , rh] of rects) assert.ok(y + rh <= 600 + 0.01, 'nothing below the edge takes your clicks');
});

test('lurking, she rides along with the window and drops when it goes', () => {
  const { h, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.lurk();
  advance(TELEPORT_S);
  const x = h.pos.x;
  h.setWindows({ fg: 5, wins: [konsole({ x: 600, y: 650 })] });
  assert.equal(h.pos.x, x + 200);
  assert.ok(h.pos.y > 650);
  h.setWindows({ fg: 0, wins: [] });
  assert.equal(h.mode, 'fall');
  assert.equal(h.perch, null);
});

test('no lurking behind a maximised window or one with no room above it', () => {
  for (const win of [konsole({ max: true }), konsole({ y: AREA.y + 10 })]) {
    const { h } = make();
    h.setWindows({ fg: 5, wins: [win] });
    assert.equal(h.lurk(), false, JSON.stringify(win));
  }
});

test('Claude starting gets her from behind the window up onto its edge', () => {
  const { h, player, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.lurk();
  advance(TELEPORT_S);
  h.goToWork();
  advance(TELEPORT_S);
  assert.equal(h.perch?.id, 5);
  assert.ok(!h.perch.behind);
  assert.equal(player.stanceName, 'sit');
});

test('while Claude works she perches on the window in front', () => {
  const { h, player, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.goToWork();
  advance(TELEPORT_S);
  assert.equal(h.perch?.id, 5);
  assert.equal(h.mode, 'work');
  assert.equal(player.stanceName, 'sit');
  assert.equal(h.pos.y, 600 + 66);
  assert.ok(h.pos.x > 400 && h.pos.x < 1300);
});

test('she rides along when her window moves', () => {
  const { h, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.goToWork();
  advance(TELEPORT_S);
  const dx = h.pos.x - 400;
  h.setWindows({ fg: 5, wins: [konsole({ x: 500, y: 550 })] });
  assert.deepEqual(h.pos, { x: 500 + dx, y: 550 + 66 });
});

test('she falls when her window closes, is maximised or is covered', () => {
  for (const next of [
    { fg: 0, wins: [] },
    { fg: 5, wins: [konsole({ max: true })] },
    { fg: 9, wins: [{ id: 9, x: 0, y: 300, w: 2560, h: 900, max: false }, konsole()] },
  ]) {
    const { h, advance } = make();
    h.setWindows({ fg: 5, wins: [konsole()] });
    h.goToWork();
    advance(TELEPORT_S);
    assert.equal(h.perch?.id, 5);
    h.setWindows(next);
    assert.equal(h.mode, 'fall', JSON.stringify(next));
    assert.equal(h.perch, null);
  }
});

test('dropped with her hips on a window edge, she sits there', () => {
  const { h, player } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  const grab = { x: h.pos.x, y: h.pos.y - 120 }; // held 120 px above her root
  assert.equal(h.onDragStart(grab), true);
  // carry her so her root is at y 656: her hips (66 px up) end 10 px above the window's top edge
  h.onDragMove({ x: 800, y: 656 - 120 });
  h.onDragEnd({ x: 800, y: 656 - 120 });
  assert.equal(h.perch?.id, 5);
  assert.equal(h.pos.y, 600 + 66);
  assert.equal(player.stanceName, 'sit');
});

test('falling past a window under her, she is caught by its ledge', () => {
  const { h, advance, said } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.pos = { x: 800, y: 300 };
  h.vy = 0;
  h.enterMode('fall');
  advance(2);
  assert.equal(h.perch?.id, 5);
  assert.equal(h.pos.y, 600 + 66);
  assert.ok(said.includes('landed'));
});

test('pickSeat prefers the window in front and skips covered spots', () => {
  const { h } = make();
  const back = { id: 7, x: 100, y: 700, w: 900, h: 500, max: false };
  h.setWindows({ fg: 5, wins: [konsole(), back] });
  assert.equal(h.pickSeat().win.id, 5);
  assert.equal(h.pickSeat({ except: 5 })?.win.id ?? null, null, 'window 7 is covered by window 5 around its top edge, or too low');
  assert.equal(h.pickSeat({ frontOnly: true }).win.id, 5);
});

// ---- possession (M2) ----

test('possess: she dives into the window she sits on, takes it over, and comes out perched', async () => {
  const { h, fxCalls, sounds, advance } = make();
  const other = { id: 8, x: 1500, y: 500, w: 800, h: 600, max: false };
  h.setWindows({ fg: 5, wins: [konsole(), other] });
  h.goToWork();
  advance(TELEPORT_S);
  h.setMode('idle');
  assert.equal(h.canPossess(), true);
  const done = h.possess();
  advance(4);
  assert.equal(await done, true);
  assert.ok(fxCalls.some((c) => c[0] === 'possess'));
  assert.ok(sounds.includes('possess'));
  assert.ok(h.perch, 'she comes out sitting on a window');
  assert.equal(h.hidden, false);
});

test('possess is off when she is not sitting, the setting is off, or motion is reduced', () => {
  const standing = make();
  standing.h.setWindows({ fg: 5, wins: [konsole()] });
  assert.equal(standing.h.canPossess(), false, 'not sitting');
  for (const settings of [{ possess: false }, { motion: 'reduced' }]) {
    const { h, advance } = make(settings);
    h.setWindows({ fg: 5, wins: [konsole()] });
    h.goToWork();
    advance(TELEPORT_S);
    assert.equal(h.canPossess(), false, JSON.stringify(settings));
  }
});

// ---- pointing (M2) ----

const overlaps = (a, b) => a[0] < b.x + b.w && b.x < a[0] + a[2] && a[1] < b.y + b.h && b.y < a[1] + a[3];

test('pointAt: she goes beside the window and points at it, with a tagged wire', () => {
  const { h, fxCalls, advance } = make();
  const win = konsole();
  h.setWindows({ fg: 9, wins: [win] });
  h.pointAt(win, { label: 'CLAUDE' });
  advance(2.5);
  assert.equal(h.mode, 'point');
  assert.equal(h.pointing.rect.id, 5);
  for (const r of h.hitRects()) assert.ok(!overlaps(r, win), 'she stands beside it, not on it');
  const wire = fxCalls.find((c) => c[0] === 'pointer');
  assert.ok(wire, 'a wire from her finger');
  assert.equal(wire[3].label, 'CLAUDE');
  const side = h.pointing.side;
  assert.ok(h.pose[side === 'R' ? 'armR' : 'armL'] > 0.5, 'her arm is up toward it');
});

test('stopPointing lets go', () => {
  const { h, advance } = make();
  h.setWindows({ fg: 9, wins: [konsole()] });
  h.pointAt(konsole(), { label: 'CLAUDE' });
  advance(2.5);
  h.stopPointing();
  advance(0.5);
  assert.equal(h.pointing, null);
  assert.notEqual(h.mode, 'point');
});

test('canPoint refuses windows you could not see', () => {
  const { h } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  assert.equal(h.canPoint(konsole()), true);
  assert.equal(h.canPoint(konsole({ max: true })), false, 'maximised');
  assert.equal(h.canPoint({ ...konsole(), w: 80 }), false, 'tiny');
  h.setWindows({ fg: 9, wins: [{ id: 9, x: 0, y: 300, w: 2560, h: 900, max: false }, konsole()] });
  assert.equal(h.canPoint(konsole()), false, 'its top is under another window');
  assert.equal(h.canPoint(null), false);
});

test('spotNear keeps her on screen beside the window, wherever it is', () => {
  const { h } = make();
  for (const win of [konsole({ x: 0, y: 40 }), konsole({ x: 1660, y: 40 }), konsole({ x: 0, y: 900 }), konsole({ x: 1660, y: 900 }), konsole({ x: 200, y: 200, w: 2200 })]) {
    const s = h.spotNear(win);
    assert.ok(s.x - h.size.w / 2 >= AREA.x && s.x + h.size.w / 2 <= AREA.x + AREA.w, JSON.stringify(win));
    assert.ok(s.y <= AREA.y + AREA.h && s.y - h.size.h >= AREA.y, JSON.stringify(win));
  }
});

// ---- final review fix: the background (Ctrl+Alt+H) always holds ----

test('background pressed mid-teleport stays background', () => {
  const { h, advance } = make();
  h.teleport({ x: 600, y: 900 });
  advance(0.1);
  h.toggleBackground();
  advance(3);
  assert.equal(h.mode, 'background');
});

test('background during the alert chase stays background', () => {
  const { h, advance } = make();
  h.onPointer({ x: 400, y: 600, inside: false });
  h.comeToPointer();
  advance(0.2);
  h.toggleBackground();
  advance(3);
  assert.equal(h.mode, 'background');
});

test('background during her victory stays background, and the victory still resolves', async () => {
  const { h, advance } = make();
  let resolved = false;
  const p = h.celebrate('x').then(() => { resolved = true; });
  advance(0.5);
  h.toggleBackground();
  advance(6);
  await p;
  assert.equal(resolved, true);
  assert.equal(h.mode, 'background');
});

test('background and back during her boot: the boot log goes', () => {
  const { h, advance } = make();
  h.boot();
  advance(0.5);
  h.toggleBackground();
  h.toggleBackground();
  advance(6);
  assert.equal(h.boot0, null);
  assert.notEqual(h.mode, 'background');
});

test('setBackground(on) does nothing when she is already there', () => {
  const { h, advance } = make();
  h.setBackground(true);
  h.setBackground(true);
  advance(0.5);
  assert.equal(h.mode, 'background');
  h.setBackground(false);
  h.setBackground(false);
  advance(0.5);
  assert.notEqual(h.mode, 'background');
});

test('clicking her core reports that she is visible again', () => {
  const { h, advance } = make();
  const reported = [];
  h.onBackground = (bg) => reported.push(bg);
  h.toggleBackground();
  advance(0.5);
  h.onClick();
  assert.deepEqual(reported, [true, false]);
});

test('an act asked for during her victory waits: the victory finishes and resolves', async () => {
  const { h, played, advance } = make();
  h.pos = { x: AREA.x + AREA.w / 2, y: AREA.y + AREA.h - 60 }; // already centre stage: no teleport first
  let resolved = false;
  const p = h.celebrate('x').then(() => { resolved = true; });
  advance(0.3);
  h.perform('hop');
  h.knockback();
  advance(6);
  await p;
  assert.equal(resolved, true);
  assert.ok(played.includes('exit0'));
  assert.ok(!played.includes('hop') && !played.includes('segfault'), 'nothing cut the victory short');
});

// ---- throwing (M2, rebuilt from the spec) ----

function fling(h, advance, to) {
  const start = { x: h.pos.x, y: h.pos.y - 120 };
  assert.equal(h.onDragStart(start), true);
  // three quick moves: fast enough to throw her
  for (let i = 1; i <= 3; i++) {
    advance(0.016);
    h.onDragMove({ x: start.x + (to.x - start.x) * (i / 3), y: start.y + (to.y - start.y) * (i / 3) });
  }
  h.onDragEnd({ x: to.x, y: to.y });
}

test('let go mid-swing, she flies off and lands', () => {
  const { h, advance } = make();
  fling(h, advance, { x: h.pos.x - 300, y: h.pos.y - 400 });
  assert.equal(h.mode, 'thrown');
  advance(4);
  assert.notEqual(h.mode, 'thrown');
  assert.equal(h.pos.y, floor);
});

test('three throws in a row and she gets mad: no picking her up for a while', () => {
  const { h, advance, said } = make();
  for (let i = 0; i < 3; i++) {
    fling(h, advance, { x: h.pos.x - 300, y: h.pos.y - 400 });
    advance(4);
  }
  assert.ok(said.includes('mad'));
  assert.equal(h.onDragStart({ x: h.pos.x, y: h.pos.y - 120 }), false, 'she won\'t be picked up');
  advance(16, 1);
  assert.equal(h.onDragStart({ x: h.pos.x, y: h.pos.y - 120 }), true, 'she forgives you after a while');
});

test('you can catch her mid-air', () => {
  const { h, advance } = make();
  fling(h, advance, { x: h.pos.x - 300, y: h.pos.y - 400 });
  advance(0.1);
  const [x, y, w, hh] = h.hitRects()[0];
  assert.equal(h.onDragStart({ x: x + w / 2, y: y + hh / 2 }), true);
  assert.equal(h.mode, 'drag');
});

test('arriving on another screen she appears near your pointer', () => {
  const { h, played, advance } = make();
  h.setArea({ x: 0, y: 0, w: 1920, h: 1080 });
  h.onPointer({ x: 900, y: 500, inside: false });
  h.arrive();
  advance(1);
  assert.ok(played.includes('teleportIn'));
  assert.ok(Math.abs(h.pos.x - 900) < 300 && h.pos.y <= 1080);
  assert.notEqual(h.mode, 'teleport');
});

test('fork(): seven copies with PID tags march into a hex lattice, then she reaps them one by one', async () => {
  const { h, fxCalls, said, advance } = make();
  let done = false;
  const p = h.fork().then((r) => { done = r; });
  advance(0.2);
  assert.equal(h.forks.length, 7);
  assert.equal(new Set(h.forks.map((f) => f.pid)).size, 7, 'a PID each');
  assert.ok(h.forks.every((f) => /^\d{3,5}$/.test(String(f.pid))));
  advance(2);
  // all at their spots: a hex lattice round the first one
  const [c, ...ring] = h.forks;
  const d = ring.map((f) => Math.hypot(f.x - c.x, f.y - c.y));
  assert.ok(Math.max(...d) - Math.min(...d) < 1, `ring distances ${d.map(Math.round)}`);
  const counts = [];
  for (let t = 0; t < 6 && h.forks.length; t += 0.1) { advance(0.1); counts.push(h.forks.length); }
  assert.equal(h.forks.length, 0);
  assert.ok(new Set(counts).size >= 4, 'reaped one by one, not all at once');
  advance(1);
  await p;
  assert.equal(done, true);
  assert.ok(said.includes('fork') && said.includes('reaped'));
  assert.ok(fxCalls.some((c) => c[0] === 'sparks'));
});

test('no forking in the background or mid-teleport', async () => {
  const { h, advance } = make();
  h.setBackground(true);
  advance(1);
  assert.equal(await h.fork(), false);
  const b = make();
  b.h.teleport({ x: 500, y: 900 });
  assert.equal(await b.h.fork(), false);
});
