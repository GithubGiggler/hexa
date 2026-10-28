import test from 'node:test';
import assert from 'node:assert/strict';
import { restSpot, corners, clampInto, peekSpots, fallStep, nextDriftTarget } from '../src/renderer/js/motion.js';

const area = { x: 0, y: 30, w: 2560, h: 1410 };
const size = { w: 110, h: 250 };

test('restSpot is the bottom-right corner, 24 px in', () => {
  const p = restSpot(area, size);
  assert.equal(p.y, area.y + area.h - 24);
  assert.equal(p.x + size.w / 2, area.x + area.w - 24);
});

test('fallStep lands exactly on the floor', () => {
  let s = { y: 0, vy: 0 };
  let landed = false;
  for (let i = 0; i < 200 && !landed; i++) ({ landed, ...s } = fallStep(s, 0.016, 800));
  assert.equal(landed, true);
  assert.equal(s.y, 800);
});

test('fallStep accelerates', () => {
  const a = fallStep({ y: 0, vy: 0 }, 0.05, 10000);
  const b = fallStep(a, 0.05, 10000);
  assert.ok(b.y - a.y > a.y);
});

test('clampInto keeps her inside a shrunken area', () => {
  const small = { x: 0, y: 0, w: 1920, h: 1080 };
  const p = clampInto(small, { x: 2400, y: 1300 }, size);
  assert.ok(p.x + size.w / 2 <= 1920);
  assert.ok(p.x - size.w / 2 >= 0);
  assert.ok(p.y <= 1080);
  assert.ok(p.y - size.h >= 0);
});

test('corners and peek spots are on screen, drift targets move her', () => {
  for (const c of corners(area, size)) assert.deepEqual(clampInto(area, c, size), c);
  const spots = peekSpots(area, size);
  assert.deepEqual(spots.map((s) => s.side).sort(), ['left', 'right', 'top']);
  const here = restSpot(area, size);
  const next = nextDriftTarget(area, size, here, () => 0.3);
  assert.ok(Math.hypot(next.x - here.x, next.y - here.y) > 50);
});
