import test from 'node:test';
import assert from 'node:assert/strict';
import { Player, ACTS, NEUTRAL, SHEET_FPS } from '../src/renderer/js/character/acting.js';

const tiny = {
  s: { loop: true, keys: [[6, { bob: -2 }], [6, { bob: 0 }]] },
  m: { keys: [[2, { head: 1 }, 'go'], [2, { head: 0 }]] },
  z: { directional: true, keys: [[2, { reach: 1.5, long: 1.8, head: 0.3, tilt: 10, smear: [12, 0] }]] },
  both: { keys: [[2, { arms: 0.7, elbows: -0.4 }]] },
};

test('holds last their frames at 12 fps, and stances loop', () => {
  assert.equal(SHEET_FPS, 12);
  const p = new Player({ acts: tiny });
  p.stance('s');
  p.tick(499);
  assert.equal(p.frame().bob, -2);
  p.tick(2);
  assert.equal(p.frame().bob, 0); // 6 frames at 12 fps = 500 ms
  p.tick(500);
  assert.equal(p.frame().bob, -2); // looped
});

test('a big tick fires a cue once and ends the act once', () => {
  const p = new Player({ acts: tiny });
  p.stance('s');
  const cues = [];
  let ended = 0;
  p.play('m', { onCue: (c) => cues.push(c), onEnd: () => { ended += 1; } });
  assert.equal(p.playing, 'm');
  assert.equal(p.frame().head, 1);
  p.tick(1000);
  assert.deepEqual(cues, ['go']);
  assert.equal(ended, 1);
  assert.equal(p.playing, null);
  p.tick(1000);
  assert.equal(ended, 1);
});

test('fast acts play at 24 fps', () => {
  const p = new Player({ acts: tiny });
  p.stance('s');
  p.play('m', { fast: true });
  p.tick(170); // 4 frames at 24 fps ≈ 167 ms
  assert.equal(p.playing, null);
});

test('an act sits on top of the stance', () => {
  const p = new Player({ acts: tiny });
  p.stance('s');
  p.play('m');
  const f = p.frame();
  assert.equal(f.head, 1);
  assert.equal(f.bob, -2); // from the stance underneath
});

test('directional acts mirror, and reach/long go to the aimed arm', () => {
  const p = new Player({ acts: tiny });
  p.stance('s');
  p.play('z', { dir: 1 });
  let f = p.frame();
  assert.equal(f.armR, 1.5);
  assert.equal(f.longR, 1.8);
  assert.equal(f.armL, 0);
  assert.equal(f.head, 0.3);
  p.play('z', { dir: -1 });
  f = p.frame();
  assert.equal(f.armL, 1.5);
  assert.equal(f.longL, 1.8);
  assert.equal(f.armR, 0);
  assert.equal(f.head, -0.3);
  assert.equal(f.tilt, -10);
  assert.deepEqual(f.smear, [-12, 0]);
  assert.ok(!('reach' in f) && !('long' in f));
});

test('arms and elbows set both sides', () => {
  const p = new Player({ acts: tiny });
  p.play('both');
  const f = p.frame();
  assert.equal(f.armL, 0.7);
  assert.equal(f.armR, 0.7);
  assert.equal(f.elbowL, -0.4);
  assert.equal(f.elbowR, -0.4);
});

test('every frame carries every neutral field', () => {
  const p = new Player({ acts: tiny });
  for (const k of Object.keys(NEUTRAL)) assert.ok(k in p.frame(), k);
  p.stance('s');
  p.play('m');
  for (const k of Object.keys(NEUTRAL)) assert.ok(k in p.frame(), k);
});

test('the drawing index moves on every new drawing', () => {
  const p = new Player({ acts: tiny });
  p.stance('s');
  const a = p.drawing;
  p.tick(84); // one frame at 12 fps
  assert.ok(p.drawing > a);
});

test("Hexa's sheets are well-formed and cover every act she needs", () => {
  const needed = ['stand', 'work', 'sit', 'peek', 'sleep', 'alert', 'dragged', 'fall',
    'curious', 'look', 'spin', 'hop', 'wave', 'yawn', 'zap', 'teleportOut', 'teleportIn', 'land', 'exit0', 'segfault',
    'suspend', 'resume', 'bootWave'];
  for (const name of needed) assert.ok(ACTS[name], name);
  for (const [name, act] of Object.entries(ACTS)) {
    assert.ok(act.keys.length >= 1, name);
    for (const key of act.keys) {
      assert.ok(Number.isInteger(key[0]) && key[0] >= 1, `${name}: hold`);
      assert.equal(typeof key[1], 'object', `${name}: pose`);
      if (key[2] !== undefined) assert.equal(typeof key[2], 'string', `${name}: cue`);
    }
  }
  const cues = (name) => ACTS[name].keys.map((k) => k[2]).filter(Boolean);
  assert.deepEqual(cues('zap'), ['bolt']);
  assert.deepEqual(cues('teleportOut'), ['shatter']);
  assert.deepEqual(cues('teleportIn'), ['assemble']);
  assert.deepEqual(cues('land'), ['land']);
  assert.deepEqual(cues('exit0'), ['rise', 'burst', 'laugh']);
  assert.deepEqual(cues('segfault'), ['impact']);
  for (const stance of ['stand', 'work', 'sit', 'peek', 'sleep', 'alert', 'dragged', 'fall']) assert.equal(ACTS[stance].loop, true, stance);
});
