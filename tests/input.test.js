'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInput, keysymFor, charKeysym, keymapFrom, parseCombo } = require('../src/main/platform/linux/input');

test('key names: X keysym names, the usual aliases, F-keys, single characters', () => {
  assert.equal(keysymFor('Return'), 0xff0d);
  assert.equal(keysymFor('enter'), 0xff0d);
  assert.equal(keysymFor('ctrl'), 0xffe3);
  assert.equal(keysymFor('super'), 0xffeb);
  assert.equal(keysymFor('Page_Down'), 0xff56);
  assert.equal(keysymFor('pagedown'), 0xff56);
  assert.equal(keysymFor('F5'), 0xffc2);
  assert.equal(keysymFor('a'), 0x61);
  assert.equal(keysymFor('tab'), 0xff09);
  assert.equal(keysymFor('nonsense-key'), null);
  assert.deepEqual(parseCombo('ctrl+shift+t'), [0xffe3, 0xffe1, 0x74]);
  assert.equal(parseCombo('ctrl+wat'), null);
});

test('characters: Latin-1 as themselves, the rest as Unicode keysyms', () => {
  assert.equal(charKeysym('A'), 0x41);
  assert.equal(charKeysym('é'), 0xe9);
  assert.equal(charKeysym('€'), 0x01000000 + 0x20ac);
  assert.equal(charKeysym('\n'), 0xff0d);
});

test('the keyboard map: which key and whether Shift, and the spare keycodes', () => {
  const { map, free } = keymapFrom([[0x61, 0x41], [0, 0], [0xffe1, 0]], 8);
  assert.deepEqual(map.get(0x61), { code: 8, shift: false });
  assert.deepEqual(map.get(0x41), { code: 8, shift: true });
  assert.deepEqual(map.get(0xffe1), { code: 10, shift: false });
  assert.deepEqual(free, [9]);
});

// a fake X server: records the XTEST events and keyboard remaps
function fakeX() {
  const events = [];
  const remaps = [];
  const rows = [[0x61, 0x41], [0x31, 0x21], [0xffe1, 0], [0xffe3, 0], [0xff0d, 0], [0, 0]]; // a A, 1 !, Shift, Ctrl, Return, spare
  const X = {
    GetKeyboardMapping: (start, n, cb) => cb(null, rows),
    GetInputFocus: (cb) => cb(null, {}),
    ChangeKeyboardMapping: (code, per, syms) => remaps.push([code, syms[0]]),
  };
  const Test = { KeyPress: 2, KeyRelease: 3, ButtonPress: 4, ButtonRelease: 5, MotionNotify: 6, FakeInput: (type, detail, t, w, x, y) => events.push([type, detail, x, y]) };
  const call = (fn) => new Promise((res, rej) => fn((e, v) => (e ? rej(e) : res(v))));
  return { X, Test, call, events, remaps };
}

test('typing: Shift for capitals and symbols, a lent keycode for what no key has', async () => {
  const f = fakeX();
  const input = await createInput({ X: f.X, root: 1, Test: f.Test, call: f.call, minKeycode: 8, maxKeycode: 13, wait: async () => {} });
  await input.type('aA!€');
  const keys = f.events.map(([t, d]) => `${t === 2 ? 'v' : '^'}${d}`).join(' ');
  assert.equal(keys, 'v8 ^8 v10 v8 ^8 ^10 v10 v9 ^9 ^10 v13 ^13');
  assert.deepEqual(f.remaps, [[13, 0x01000000 + 0x20ac], [13, 0]], 'the spare key lent for €, then given back');
});

test('a combo goes down in order and up in reverse; a click moves first', async () => {
  const f = fakeX();
  const input = await createInput({ X: f.X, root: 1, Test: f.Test, call: f.call, minKeycode: 8, maxKeycode: 13, wait: async () => {} });
  await input.key('ctrl+a');
  assert.deepEqual(f.events.map(([t, d]) => [t, d]), [[2, 11], [2, 8], [3, 8], [3, 11]]);
  f.events.length = 0;
  await input.click(100, 200, { button: 'right' });
  assert.deepEqual(f.events, [[6, 0, 100, 200], [4, 3, 0, 0], [5, 3, 0, 0]]);
  await assert.rejects(input.key('ctrl+nope'), /not a key/);
});
