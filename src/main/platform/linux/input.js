'use strict';

// Her hands on your computer, for computer use (only when you asked her to do something and said
// Start): synthetic pointer and keyboard input through the X server's XTEST extension. Key names
// are X keysym names ("Return", "Tab", "Page_Down", "a"), joined with + for combinations
// ("ctrl+l", "alt+Tab", "ctrl+shift+t"); text is typed character by character, with Shift where
// the keyboard map needs it, and characters no key has are typed by lending a spare keycode the
// character for a moment (what xdotool does).

const KEYSYMS = require('x11/lib/keysyms');

const ALIASES = {
  ctrl: 'Control_L', control: 'Control_L', alt: 'Alt_L', shift: 'Shift_L', super: 'Super_L', meta: 'Super_L',
  win: 'Super_L', cmd: 'Super_L', enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab',
  backspace: 'BackSpace', delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
  pageup: 'Prior', page_up: 'Prior', pgup: 'Prior', pagedown: 'Next', page_down: 'Next', pgdn: 'Next',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', space: 'space', minus: 'minus', plus: 'plus',
};
const BUTTON = { left: 1, middle: 2, right: 3, up: 4, down: 5, scrollLeft: 6, scrollRight: 7 };
const MAX_TYPE = 2000;   // characters she types at once
const MAX_HOLD_MS = 5000; // how long she holds a key down

function stopped(signal) {
  if (signal?.aborted) {
    const err = new Error('stopped (Escape)');
    err.name = 'AbortError';
    throw err;
  }
}

// keysym number for a key name, or null
function keysymFor(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const alias = ALIASES[raw.toLowerCase()];
  const n = alias || raw;
  if (KEYSYMS[`XK_${n}`]) return KEYSYMS[`XK_${n}`].code;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(n)) return KEYSYMS[`XK_F${n.slice(1)}`].code;
  if ([...n].length === 1) return charKeysym(n);
  const cap = n[0].toUpperCase() + n.slice(1);
  if (KEYSYMS[`XK_${cap}`]) return KEYSYMS[`XK_${cap}`].code;
  return null;
}

// Latin-1 characters are their own keysyms; everything else is 0x01000000 + its code point.
function charKeysym(ch) {
  const cp = ch.codePointAt(0);
  if (ch === '\n') return KEYSYMS.XK_Return.code;
  if (ch === '\t') return KEYSYMS.XK_Tab.code;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return 0x01000000 + cp;
}

// keysym -> { code, shift } from a GetKeyboardMapping result (rows from minKeycode)
function keymapFrom(rows, minKeycode) {
  const map = new Map();
  const free = [];
  rows.forEach((syms, i) => {
    const code = minKeycode + i;
    if (syms.every((s) => !s)) free.push(code);
    syms.slice(0, 2).forEach((sym, col) => {
      if (sym && !map.has(sym)) map.set(sym, { code, shift: col === 1 });
    });
  });
  return { map, free };
}

// "ctrl+shift+t" -> [keysyms], or null if a part isn't a key
function parseCombo(text) {
  const parts = String(text || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const syms = parts.map(keysymFor);
  return syms.every((s) => s !== null) ? syms : null;
}

// aroundEscape(fn): main's Escape grab (how you stop her) would catch her own Escape too; for it,
// main lets go of the grab while fn presses the key.
async function createInput({ X, root, Test, call, minKeycode, maxKeycode, wait = (ms) => new Promise((r) => setTimeout(r, ms)), aroundEscape = (fn) => fn() }) {
  const count = maxKeycode - minKeycode + 1;
  const rows = await call((cb) => X.GetKeyboardMapping(minKeycode, count, cb));
  const { map, free } = keymapFrom(rows, minKeycode);
  const shiftCode = map.get(KEYSYMS.XK_Shift_L.code)?.code;
  const keysDown = new Set();
  const buttonsDown = new Set();
  // every press and release goes through here, so she knows what she's holding (releaseAll)
  const fake = (type, detail, x = 0, y = 0) => {
    if (type === Test.KeyPress) keysDown.add(detail);
    else if (type === Test.KeyRelease) keysDown.delete(detail);
    else if (type === Test.ButtonPress) buttonsDown.add(detail);
    else if (type === Test.ButtonRelease) buttonsDown.delete(detail);
    Test.FakeInput(type, detail, 0, root, x, y);
  };
  const sync = () => call((cb) => X.GetInputFocus(cb));

  const lending = new Map(); // keysym -> the spare keycode lent to it while it's down
  const pressSym = async (sym, down) => {
    let code = map.get(sym)?.code ?? lending.get(sym);
    if (!code && down) {
      // no key has it: lend a spare keycode the keysym for this one press
      code = free[0];
      if (!code) return false;
      X.ChangeKeyboardMapping(code, 1, [sym, sym]);
      await sync();
      lending.set(sym, code);
    }
    if (!code) return false;
    fake(down ? Test.KeyPress : Test.KeyRelease, code);
    if (!down && lending.has(sym)) {
      lending.delete(sym);
      await sync();
      X.ChangeKeyboardMapping(code, 1, [0, 0]); // given back
    }
    return true;
  };

  const input = {
    move(x, y) {
      fake(Test.MotionNotify, 0, Math.round(x), Math.round(y));
      return sync();
    },
    async click(x, y, { button = 'left', count = 1, modifiers = '' } = {}) {
      if (x !== undefined && y !== undefined) await input.move(x, y);
      const mods = modifiers ? parseCombo(modifiers) || [] : [];
      for (const m of mods) await pressSym(m, true);
      for (let i = 0; i < count; i++) {
        fake(Test.ButtonPress, BUTTON[button]);
        fake(Test.ButtonRelease, BUTTON[button]);
        if (i < count - 1) await wait(60);
      }
      for (const m of mods.reverse()) await pressSym(m, false);
      return sync();
    },
    buttonDown(button = 'left') { fake(Test.ButtonPress, BUTTON[button]); return sync(); },
    buttonUp(button = 'left') { fake(Test.ButtonRelease, BUTTON[button]); return sync(); },
    // stopped, or done: nothing she pressed stays down
    async releaseAll() {
      for (const code of [...keysDown]) fake(Test.KeyRelease, code);
      for (const b of [...buttonsDown]) fake(Test.ButtonRelease, b);
      for (const [sym, code] of lending) {
        X.ChangeKeyboardMapping(code, 1, [0, 0]);
        lending.delete(sym);
      }
      return sync();
    },
    async drag(from, to, { modifiers = '' } = {}) {
      const mods = modifiers ? parseCombo(modifiers) || [] : [];
      await input.move(from[0], from[1]);
      for (const m of mods) await pressSym(m, true);
      fake(Test.ButtonPress, 1);
      await wait(80);
      // a few steps on the way, so the app sees a drag rather than a jump
      for (let i = 1; i <= 8; i++) fake(Test.MotionNotify, 0, Math.round(from[0] + ((to[0] - from[0]) * i) / 8), Math.round(from[1] + ((to[1] - from[1]) * i) / 8));
      await wait(40);
      fake(Test.ButtonRelease, 1);
      for (const m of mods.reverse()) await pressSym(m, false);
      return sync();
    },
    async scroll(direction, amount = 3, at = null, { modifiers = '' } = {}) {
      if (at) await input.move(at[0], at[1]);
      const button = { up: 'up', down: 'down', left: 'scrollLeft', right: 'scrollRight' }[direction];
      if (!button) throw new Error(`no scroll direction "${direction}"`);
      const mods = modifiers ? parseCombo(modifiers) || [] : [];
      for (const m of mods) await pressSym(m, true);
      for (let i = 0; i < Math.min(50, Math.max(1, amount)); i++) {
        fake(Test.ButtonPress, BUTTON[button]);
        fake(Test.ButtonRelease, BUTTON[button]);
      }
      for (const m of mods.reverse()) await pressSym(m, false);
      return sync();
    },
    // "ctrl+l", "Return", "alt+Tab"; held for holdMs when given
    async key(combo, { repeat = 1, holdMs = 0, signal } = {}) {
      const syms = parseCombo(combo);
      if (!syms) throw new Error(`not a key: "${combo}"`);
      const press = async () => {
        for (let n = 0; n < Math.min(100, Math.max(1, repeat)); n++) {
          stopped(signal);
          for (const s of syms) await pressSym(s, true);
          if (holdMs) await wait(Math.min(MAX_HOLD_MS, holdMs));
          for (const s of [...syms].reverse()) await pressSym(s, false);
        }
      };
      if (syms.includes(KEYSYMS.XK_Escape.code)) await aroundEscape(press);
      else await press();
      return sync();
    },
    async type(text, { delayMs = 8, signal } = {}) {
      const chars = [...String(text)];
      if (chars.length > MAX_TYPE) throw new Error(`too much to type at once (${chars.length} characters, ${MAX_TYPE} at most)`);
      for (const ch of chars) {
        stopped(signal);
        const sym = charKeysym(ch);
        const key = map.get(sym);
        const shifted = key?.shift && shiftCode;
        if (shifted) fake(Test.KeyPress, shiftCode);
        await pressSym(sym, true);
        await pressSym(sym, false);
        if (shifted) fake(Test.KeyRelease, shiftCode);
        if (delayMs) await wait(delayMs);
      }
      return sync();
    },
  };
  return input;
}

module.exports = { createInput, keysymFor, charKeysym, keymapFrom, parseCombo, BUTTON };
