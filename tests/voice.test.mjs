import test from 'node:test';
import assert from 'node:assert/strict';
import { Voice, SOUNDS, pickCustom } from '../src/renderer/js/voice.js';

// An AudioContext that builds nothing and counts what it was asked for.
function mockAudio() {
  const counts = { osc: 0, source: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (extra = {}) => ({ connect(n) { return n || this; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: node(),
    resume() {},
    createGain: () => node({ gain: param() }),
    createOscillator: () => { counts.osc += 1; return node({ type: 'sine', frequency: param(), detune: param(), start() {}, stop() {} }); },
    createWaveShaper: () => node({ curve: null }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => { counts.source += 1; return node({ buffer: null, start() {}, stop() {}, playbackRate: param() }); },
  };
  return { make: () => ctx, counts };
}

test('every sound she has is listed', () => {
  assert.deepEqual(SOUNDS, ['boot', 'hello', 'teleport-out', 'teleport-in', 'done', 'alert', 'error', 'land', 'rise', 'bolt', 'charge', 'blip', 'tick']);
});

test('pickCustom maps known names, first one wins, ignores the rest', () => {
  const m = pickCustom(['done.ogg', 'Done.WAV', 'readme.txt', 'zap.mp3', 'alert.m4a', 'land.flac']);
  assert.deepEqual([...m.entries()], [['done', 'done.ogg'], ['alert', 'alert.m4a']]);
});

test('every sound plays without throwing and builds something', () => {
  for (const name of SOUNDS) {
    const { make, counts } = mockAudio();
    const v = new Voice({ audio: make });
    v.play(name);
    assert.ok(counts.osc + counts.source > 0, name);
  }
});

test('muted: nothing is built', () => {
  const { make, counts } = mockAudio();
  const v = new Voice({ audio: make, muted: true });
  v.play('done');
  assert.equal(counts.osc + counts.source, 0);
  v.setMuted(false);
  v.play('done');
  assert.ok(counts.osc > 0);
});

test('an unknown sound is a no-op', () => {
  const { make, counts } = mockAudio();
  const v = new Voice({ audio: make });
  v.play('nope');
  assert.equal(counts.osc + counts.source, 0);
});

test('blips are throttled so typing never turns into a buzz', () => {
  const { make, counts } = mockAudio();
  let t = 0;
  const v = new Voice({ audio: make, now: () => t });
  v.play('blip');
  const one = counts.osc;
  t += 10;
  v.play('blip');
  assert.equal(counts.osc, one);
  t += 100;
  v.play('blip');
  assert.ok(counts.osc > one);
});
