import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRig, solvePose } from '../src/renderer/js/character/rig.js';
import { Chain } from '../src/renderer/js/character/physics.js';
import { drawCharacter, drawCore, makeChains } from '../src/renderer/js/character/draw.js';
import { drawGlyph, GLYPH_NAMES } from '../src/renderer/js/character/glyphs.js';
import { NEUTRAL } from '../src/renderer/js/character/acting.js';

const pack = JSON.parse(fs.readFileSync(new URL('../packs/hexa/pack.json', import.meta.url), 'utf8'));

// A canvas context that records every call and accepts any property.
function mockCtx() {
  const calls = [];
  const props = {};
  const ctx = new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return k === 'createLinearGradient' || k === 'createRadialGradient' ? { addColorStop() {} } : undefined; }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}

test('drawCharacter draws every part, for every visor glyph, without throwing', () => {
  const rig = buildRig(pack);
  const xf = solvePose(rig, NEUTRAL, { x: 200, y: 400, scale: 1, dir: 1 });
  const chains = makeChains(rig);
  assert.ok(chains instanceof Map && chains.size === pack.chains.length);
  assert.ok([...chains.values()].every((c) => c instanceof Chain));
  const filled = pack.parts.filter((p) => p.fill && p.fill !== 'none').length;
  for (const visor of GLYPH_NAMES) {
    const { ctx, calls } = mockCtx();
    drawCharacter(ctx, rig, xf, chains, NEUTRAL, { visor, emblem: '#3ef2ff', link: 1, boil: 3 });
    assert.ok(calls.filter((c) => c === 'fill').length >= filled, visor);
    assert.ok(calls.includes('stroke'), visor);
    // every save is matched by a restore: nothing leaks into the next drawing
    assert.equal(calls.filter((c) => c === 'save').length, calls.filter((c) => c === 'restore').length, visor);
  }
});

test('the same drawing index boils the same way', () => {
  const rig = buildRig(pack);
  const xf = solvePose(rig, NEUTRAL, { x: 200, y: 400, scale: 1, dir: 1 });
  const record = (boil) => {
    const pts = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'moveTo' || k === 'lineTo') pts.push(a.join(',')); }), set: (t, k, v) => { t[k] = v; return true; } });
    drawCharacter(ctx, rig, xf, new Map(), NEUTRAL, { visor: 'calm', emblem: '#fff', link: 0, boil });
    return pts.join(';');
  };
  assert.equal(record(5), record(5));
  assert.notEqual(record(5), record(6));
});

test('drawGlyph and drawCore run on a canvas', () => {
  const { ctx, calls } = mockCtx();
  drawGlyph(ctx, pack.glyphs.heart, [0, 0, 60, 20], '#ffb43a');
  assert.ok(calls.includes('arc') || calls.includes('fillRect'));
  const core = mockCtx();
  drawCore(core.ctx, 50, 50, 40, { visor: pack.glyphs.sleepy, emblem: '#3ef2ff', palette: pack.palette });
  assert.ok(core.calls.includes('fill'));
});
