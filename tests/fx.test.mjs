import test from 'node:test';
import assert from 'node:assert/strict';
import { Fx } from '../src/renderer/js/fx.js';

const palette = { cyan: '#3ef2ff', white: '#f4f7ff', magenta: '#ff3ea5', amber: '#ffb43a', red: '#ff4d4d', navy: '#141a2e' };
let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const run = (fx, seconds, step = 0.05) => { for (let t = 0; t < seconds; t += step) fx.update(step); };

test('shards die after their lifetime', () => {
  const fx = new Fx({ palette, rand });
  fx.shards(100, 100, 20);
  assert.equal(fx.count(), 20);
  run(fx, 4);
  assert.equal(fx.count(), 0);
});

test('the particle count never exceeds the cap', () => {
  const fx = new Fx({ palette, rand, cap: 600 });
  for (let i = 0; i < 50; i++) fx.shards(0, 0, 100);
  assert.ok(fx.count() <= 600);
});

test('a bolt runs from its start to its end', () => {
  const fx = new Fx({ palette, rand });
  const bolt = fx.bolt({ x: 0, y: 0 }, { x: 100, y: 50 });
  assert.deepEqual(bolt.points[0], { x: 0, y: 0 });
  assert.deepEqual(bolt.points.at(-1), { x: 100, y: 50 });
  assert.ok(bolt.points.length > 3, 'jagged, not a straight line');
  run(fx, 0.2);
  assert.deepEqual(bolt.points[0], { x: 0, y: 0 }, 'redrawn on twos, ends still pinned');
  assert.deepEqual(bolt.points.at(-1), { x: 100, y: 50 });
});

test('a huge time step leaves everything finite', () => {
  const fx = new Fx({ palette, rand });
  fx.shards(10, 10, 30, { spread: 400 });
  fx.sparks(10, 10);
  fx.glyphs(10, 10);
  fx.assemble([{ x: 0, y: 0 }, { x: 500, y: 300 }], { x: 200, y: 200 }, 400);
  fx.update(5);
  for (const p of fx.particles) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('assemble pulls points onto the target in time', () => {
  const fx = new Fx({ palette, rand });
  fx.assemble([{ x: 0, y: 0 }, { x: 400, y: 0 }], { x: 200, y: 100 }, 300);
  run(fx, 0.29, 0.01);
  for (const p of fx.particles) assert.ok(Math.hypot(p.x - 200, p.y - 100) < 30);
});

test('an impact lasts two drawings (167 ms), then clears', () => {
  const fx = new Fx({ palette, rand });
  fx.impact('red', 50, 50);
  assert.equal(fx.impactKind(), 'red');
  run(fx, 0.15);
  assert.equal(fx.impactKind(), 'red');
  fx.update(0.05);
  assert.equal(fx.impactKind(), null);
});

test('glitch is active for its duration and reports its strength', () => {
  const fx = new Fx({ palette, rand });
  assert.equal(fx.glitching(), 0);
  fx.glitch(300, 0.8);
  assert.equal(fx.glitching(), 0.8);
  run(fx, 0.35);
  assert.equal(fx.glitching(), 0);
});

test('an orb arcs over the straight line from one spot to another, and is gone when it lands', () => {
  const fx = new Fx({ palette, rand });
  const orb = fx.orb({ x: 100, y: 800 }, { x: 900, y: 800 }, 600);
  assert.deepEqual({ x: orb.x, y: orb.y }, { x: 100, y: 800 });
  run(fx, 0.3);
  assert.ok(orb.x > 300 && orb.x < 700, `x ${orb.x}`);
  assert.ok(orb.y < 800 - 60, `mid-flight it rides above the line (y ${orb.y})`);
  assert.ok(orb.trail.length > 2, 'it leaves a trail');
  run(fx, 0.35);
  assert.ok(!fx.effects.includes(orb));
});

test('an orb going up arcs higher than its destination', () => {
  const fx = new Fx({ palette, rand });
  const orb = fx.orb({ x: 500, y: 1300 }, { x: 900, y: 500 }, 800);
  let top = Infinity;
  for (let t = 0; t < 0.8; t += 0.02) { fx.update(0.02); top = Math.min(top, orb.y); }
  assert.ok(top < 500, `top ${top}`);
});

test('rings: two of them, gone after a moment', () => {
  const fx = new Fx({ palette, rand });
  fx.rings(400, 900);
  assert.equal(fx.effects.filter((e) => e.kind === 'feetRing').length, 2);
  run(fx, 1);
  assert.equal(fx.effects.length, 0);
});

test('draw runs on a canvas for every effect', () => {
  const fx = new Fx({ palette, rand });
  fx.shards(1, 1, 3); fx.bolt({ x: 0, y: 0 }, { x: 9, y: 9 }); fx.glyphs(1, 1); fx.sparks(1, 1);
  fx.speedLines(50, 50); fx.shockwave(5, 5); fx.slit(5, 5); fx.column(5, 5); fx.impact('white', 5, 5);
  fx.orb({ x: 0, y: 0 }, { x: 300, y: 100 }, 400); fx.update(0.1); fx.rings(5, 5);
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; return true; } });
  fx.draw(ctx, 800, 600);
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
});

test('visibleParts: a window minus the windows in front of it', async () => {
  const { visibleParts } = await import('../src/renderer/js/fx.js');
  const area = (rs) => rs.reduce((n, r) => n + r.w * r.h, 0);
  const win = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(area(visibleParts(win, [])), 10000);
  assert.equal(area(visibleParts(win, [{ x: 50, y: 0, w: 100, h: 100 }])), 5000);
  assert.equal(area(visibleParts(win, [{ x: 25, y: 25, w: 50, h: 50 }])), 7500);
  assert.equal(area(visibleParts(win, [{ x: -10, y: -10, w: 200, h: 200 }])), 0);
  const parts = visibleParts(win, [{ x: 25, y: 25, w: 50, h: 50 }, { x: 0, y: 0, w: 10, h: 10 }]);
  assert.equal(area(parts), 7400);
  for (const p of parts) assert.ok(!(p.x < 75 && p.x + p.w > 25 && p.y < 75 && p.y + p.h > 25), 'nothing drawn over a covering window');
});

test('possess draws on the window, lasts until leave(), and follows the window', () => {
  const fx = new Fx({ palette, rand });
  let rect = { x: 100, y: 100, w: 600, h: 400 };
  const taken = fx.possess(() => rect, { covers: () => [], look: () => ({ x: 300, y: 300 }), glyphs: { laugh: [['#####', '#####', '#####', '#####', '#####'], ['#####', '#####', '#####', '#####', '#####']], wide: [['#####', '#####', '#####', '#####', '#####'], ['#####', '#####', '#####', '#####', '#####']] } });
  run(fx, 1);
  assert.ok(fx.effects.some((e) => e.kind === 'possess'));
  rect = { x: 300, y: 200, w: 600, h: 400 };
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; return true; } });
  fx.draw(ctx);
  assert.ok(calls.some(([k, x, y]) => k === 'strokeRect' && x === 300 && y === 200), 'drawn where the window is now');
  taken.leave();
  run(fx, 1);
  assert.ok(!fx.effects.some((e) => e.kind === 'possess'));
});

test('pointer: a tagged wire to a window, reeled back in on retract', () => {
  const fx = new Fx({ palette, rand });
  const wire = fx.pointer(() => ({ x: 10, y: 10 }), () => ({ x: 100, y: 100, w: 300, h: 200 }), { label: 'CLAUDE' });
  run(fx, 1);
  assert.ok(fx.effects.some((e) => e.kind === 'pointer'), 'holds while pointing');
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return { addColorStop() {}, width: 40 }; }), set: (t, k, v) => { t[k] = v; return true; } });
  fx.draw(ctx);
  assert.ok(calls.some(([k, text]) => k === 'fillText' && text === 'CLAUDE'));
  wire.retract();
  run(fx, 0.6);
  assert.ok(!fx.effects.some((e) => e.kind === 'pointer'));
});
