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
  advance(1.5);
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
  advance(1.5);
  assert.ok(played.includes('teleportOut') && played.includes('teleportIn'));
  assert.ok(fxCalls.some((c) => c[0] === 'slit'));
  assert.ok(fxCalls.some((c) => c[0] === 'shards'));
  assert.deepEqual(h.pos, { x: 400, y: 900 });
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

test('while Claude works she perches on the window in front', () => {
  const { h, player, advance } = make();
  h.setWindows({ fg: 5, wins: [konsole()] });
  h.goToWork();
  advance(1.5);
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
  advance(1.5);
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
    advance(1.5);
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
  advance(1.5);
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
    advance(1.5);
    assert.equal(h.canPossess(), false, JSON.stringify(settings));
  }
});
