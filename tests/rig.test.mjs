import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePack } from '../src/renderer/js/character/pack.js';
import { buildRig, solvePose, partBounds, hitRects } from '../src/renderer/js/character/rig.js';
import { Chain } from '../src/renderer/js/character/physics.js';
import { GLYPH_NAMES } from '../src/renderer/js/character/glyphs.js';
import { NEUTRAL } from '../src/renderer/js/character/acting.js';

const hexaPack = JSON.parse(fs.readFileSync(new URL('../packs/hexa/pack.json', import.meta.url), 'utf8'));
const at = { x: 100, y: 300, scale: 1, dir: 1 };

test('the Hexa pack is valid', () => {
  assert.deepEqual(validatePack(hexaPack), { ok: true, errors: [] });
});

test('a bone with a missing parent is reported', () => {
  const broken = { ...hexaPack, bones: [...hexaPack.bones, { id: 'x', parent: 'nope', x: 0, y: 0 }] };
  const r = validatePack(broken);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /nope/.test(e)));
});

test('a part on an unknown bone, or with bad path data, is reported', () => {
  assert.equal(validatePack({ ...hexaPack, parts: [...hexaPack.parts, { id: 'p', bone: 'ghost', path: 'M 0 0 L 1 1 Z', fill: 'navy', z: 1 }] }).ok, false);
  assert.equal(validatePack({ ...hexaPack, parts: [...hexaPack.parts, { id: 'p', bone: 'head', path: 'M 0 0 A 1 1 0 0 0 2 2', fill: 'navy', z: 1 }] }).ok, false);
});

test('every glyph is two 5×5 dot matrices, and all twelve are there', () => {
  assert.deepEqual(Object.keys(hexaPack.glyphs).sort(), [...GLYPH_NAMES].sort());
  for (const [name, eyes] of Object.entries(hexaPack.glyphs)) {
    assert.equal(eyes.length, 2, name);
    for (const rows of eyes) {
      assert.equal(rows.length, 5, name);
      for (const row of rows) assert.match(row, /^[.#]{5}$/, name);
    }
  }
});

test('forward kinematics: head above hips, feet near the root', () => {
  const rig = buildRig(hexaPack);
  const xf = solvePose(rig, NEUTRAL, at);
  assert.ok(xf.get('head').y < xf.get('hips').y);
  assert.ok(xf.get('hips').y < at.y);
  assert.ok(Math.abs(xf.get('footL').y - at.y) < 20);
});

test('dir -1 mirrors around x', () => {
  const rig = buildRig(hexaPack);
  const pose = { ...NEUTRAL, armL: 1 };
  const a = solvePose(rig, pose, at).get('handL').x - at.x;
  const b = solvePose(rig, pose, { ...at, dir: -1 }).get('handL').x - at.x;
  assert.ok(Math.abs(a + b) < 1e-6);
});

test('raising an arm lifts its hand', () => {
  const rig = buildRig(hexaPack);
  const down = solvePose(rig, NEUTRAL, at).get('handL').y;
  const up = solvePose(rig, { ...NEUTRAL, armL: 2.6 }, at).get('handL').y;
  assert.ok(up < down - 40);
});

test('a long arm reaches further but the hand keeps its size', () => {
  const rig = buildRig(hexaPack);
  const pose = { ...NEUTRAL, armR: 1.57 };
  const normal = solvePose(rig, pose, at);
  const long = solvePose(rig, { ...pose, longR: 2 }, at);
  assert.ok(Math.abs(long.get('handR').x - at.x) > Math.abs(normal.get('handR').x - at.x) + 20);
  assert.ok(Math.abs(long.get('handR').sy - normal.get('handR').sy) < 1e-9);
});

test('scale and bob move her', () => {
  const rig = buildRig(hexaPack);
  const big = solvePose(rig, NEUTRAL, { ...at, scale: 2 });
  const bobbed = solvePose(rig, { ...NEUTRAL, bob: -10 }, at);
  assert.ok(at.y - big.get('head').y > 1.9 * (at.y - solvePose(rig, NEUTRAL, at).get('head').y));
  assert.ok(Math.abs(bobbed.get('head').y - (solvePose(rig, NEUTRAL, at).get('head').y - 10)) < 1e-6);
});

test('hit rects cover her head and stay few', () => {
  const rig = buildRig(hexaPack);
  const xf = solvePose(rig, NEUTRAL, at);
  const rects = hitRects(rig, xf);
  assert.ok(rects.length >= 1 && rects.length <= 12);
  const h = xf.get('head');
  assert.ok(rects.some(([x, y, w, ht]) => x <= h.x && h.x <= x + w && y <= h.y - 30 && h.y - 30 <= y + ht));
  const bounds = partBounds(rig, xf);
  assert.equal(bounds.size, hexaPack.parts.length);
});

test('a chain hangs under gravity', () => {
  const c = new Chain({ segments: 4, length: 12, stiffness: 0.5, damping: 0.9 });
  for (let i = 0; i < 120; i++) c.step({ x: 0, y: 0, a: 0 }, 1 / 60);
  assert.ok(c.points.at(-1).y > 40);
});

test('a 5-second hitch does not blow the chain apart', () => {
  const c = new Chain({ segments: 4, length: 12, stiffness: 0.5, damping: 0.9 });
  for (let i = 0; i < 30; i++) c.step({ x: 0, y: 0, a: 0 }, 1 / 60, 50);
  c.step({ x: 0, y: 0, a: 0 }, 5, 400);
  assert.ok(c.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(c.points.every((p) => Math.hypot(p.x, p.y) <= 4 * 12 + 1));
});
