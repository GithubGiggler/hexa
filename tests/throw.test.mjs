import test from 'node:test';
import assert from 'node:assert/strict';
import { flightStep } from '../src/renderer/js/motion.js';

const area = { x: 0, y: 30, w: 2560, h: 1410 };
const size = { w: 110, h: 250 };
const floor = area.y + area.h;
const fly = (s, seconds, ledges = [], step = 1 / 60) => {
  const events = [];
  for (let t = 0; t < seconds; t += step) {
    const r = flightStep(s, step, { area, size, ledges, hipDy: 66 });
    s = r.state;
    events.push(...r.events);
    if (r.state.done) break;
  }
  return { s, events };
};

test('gravity pulls her down', () => {
  const r = flightStep({ x: 1000, y: 500, vx: 0, vy: 0, spin: 0 }, 0.1, { area, size, ledges: [], hipDy: 66 });
  assert.ok(r.state.vy > 0 && r.state.y > 500);
});

test('thrown hard into the right edge she crashes, sticks a moment, then bounces off', () => {
  const { s, events } = fly({ x: 2200, y: 600, vx: 3000, vy: -100, spin: 0 }, 0.6);
  const crash = events.find((e) => e.type === 'crash');
  assert.ok(crash, 'a crash');
  assert.equal(crash.side, 'right');
  assert.ok(s.x + size.w / 2 <= area.x + area.w + 0.5);
  const later = fly({ ...s }, 0.6).s;
  assert.ok(later.vx < 0 || later.x < s.x, 'bounced back the other way');
});

test('a soft hit on the left edge just bounces', () => {
  const { events, s } = fly({ x: 200, y: 600, vx: -500, vy: 0, spin: 0 }, 0.5);
  assert.ok(events.some((e) => e.type === 'bounce' && e.side === 'left'));
  assert.ok(!events.some((e) => e.type === 'crash'));
  assert.ok(s.vx > 0);
});

test('falling slowly onto a window ledge, she is caught by it', () => {
  const ledge = { id: 5, x: 400, y: 900, w: 900 };
  const { events, s } = fly({ x: 800, y: 700, vx: 0, vy: 0, spin: 0 }, 1, [ledge]);
  const hit = events.find((e) => e.type === 'ledge');
  assert.ok(hit && hit.caught && hit.id === 5);
  assert.ok(s.done);
});

test('coming down fast onto a ledge, she bounces off it and the window shakes', () => {
  const ledge = { id: 5, x: 400, y: 900, w: 900 };
  const { events } = fly({ x: 800, y: 300, vx: 0, vy: 2600, spin: 0 }, 0.4, [ledge]);
  const hit = events.find((e) => e.type === 'ledge');
  assert.ok(hit && !hit.caught);
});

test('landing upright she skids; spinning she sprawls', () => {
  const upright = fly({ x: 1000, y: 1200, vx: 600, vy: 400, spin: 0 }, 1).events.find((e) => e.type === 'floor');
  assert.equal(upright.upright, true);
  const tumbling = fly({ x: 1000, y: 1200, vx: 600, vy: 400, spin: 9 }, 1).events.find((e) => e.type === 'floor');
  assert.equal(tumbling.upright, false);
});

test('a huge time step stays finite and inside the screen', () => {
  const r = flightStep({ x: 1000, y: 500, vx: 90000, vy: -90000, spin: 50 }, 5, { area, size, ledges: [], hipDy: 66 });
  assert.ok(Number.isFinite(r.state.x) && Number.isFinite(r.state.y));
  assert.ok(r.state.x - size.w / 2 >= area.x - 0.5 && r.state.x + size.w / 2 <= area.x + area.w + 0.5);
  assert.ok(r.state.y <= floor);
});
