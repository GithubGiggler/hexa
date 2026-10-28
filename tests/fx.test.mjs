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

test('draw runs on a canvas for every effect', () => {
  const fx = new Fx({ palette, rand });
  fx.shards(1, 1, 3); fx.bolt({ x: 0, y: 0 }, { x: 9, y: 9 }); fx.glyphs(1, 1); fx.sparks(1, 1);
  fx.speedLines(50, 50); fx.shockwave(5, 5); fx.slit(5, 5); fx.column(5, 5); fx.impact('white', 5, 5);
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; return true; } });
  fx.draw(ctx, 800, 600);
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
});

test('bounds() is the room live effects need, null when there are none', () => {
  const fx = new Fx({ palette, rand });
  assert.equal(fx.bounds(), null);
  fx.shockwave(500, 500);
  const [x, y, w, h] = fx.bounds();
  assert.ok(x <= 500 - 200 && y <= 500 - 200 && x + w >= 500 + 200 && y + h >= 500 + 200);
  fx.bolt({ x: 100, y: 100 }, { x: 140, y: 120 });
  const b = fx.bounds();
  assert.ok(b[0] <= 100 && b[1] <= 100);
});

test('dropFar removes what is far from her', () => {
  const fx = new Fx({ palette, rand });
  fx.shards(100, 100, 10, { spread: 1 });
  fx.slit(100, 100);
  fx.shards(2000, 1000, 5, { spread: 1 });
  fx.dropFar(2000, 1000, 400);
  assert.equal(fx.count(), 5);
  assert.ok(fx.effects.every((e) => e.kind !== 'slit'));
});

test('the teleport scar and the light column stay small and short', () => {
  const fx = new Fx({ palette, rand });
  fx.slit(100, 900);
  fx.column(100, 900);
  const slit = fx.effects.find((e) => e.kind === 'slit');
  assert.ok(slit.life <= 0.35);
  const [, y] = fx.bounds();
  assert.ok(900 - y <= 380, 'the column does not reach up the whole screen');
});
