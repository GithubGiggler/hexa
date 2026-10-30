'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { frameRect, isTrackable, toSnapshot, SKIP_TYPES } = require('../src/main/platform/linux/window-model');

test('server-side decorations: the frame grows by _NET_FRAME_EXTENTS', () => {
  assert.deepEqual(frameRect({ x: 100, y: 130, w: 800, h: 600 }, [4, 4, 30, 4], null), { x: 96, y: 100, w: 808, h: 634 });
});

test('client-side decorations: the GTK shadow is subtracted', () => {
  assert.deepEqual(frameRect({ x: 100, y: 100, w: 852, h: 652 }, null, [26, 26, 23, 29]), { x: 126, y: 123, w: 800, h: 600 });
});

test('only real windows on this desktop are tracked', () => {
  const ok = { types: ['_NET_WM_WINDOW_TYPE_NORMAL'], states: [], desktop: 1, currentDesktop: 1, isSelf: false };
  assert.equal(isTrackable(ok), true);
  assert.equal(isTrackable({ ...ok, types: [] }), true, 'no type means normal');
  for (const t of SKIP_TYPES) assert.equal(isTrackable({ ...ok, types: [t] }), false, t);
  assert.equal(isTrackable({ ...ok, states: ['_NET_WM_STATE_HIDDEN'] }), false, 'minimised');
  assert.equal(isTrackable({ ...ok, desktop: 2 }), false, 'another desktop');
  assert.equal(isTrackable({ ...ok, desktop: 0xffffffff }), true, 'on all desktops');
  assert.equal(isTrackable({ ...ok, desktop: undefined }), true);
  assert.equal(isTrackable({ ...ok, isSelf: true }), false, 'her own window');
});

test('snapshots are front first, display-relative DIP, with maximised flagged', () => {
  const display = { x: 0, y: 1080, width: 2560, height: 1440 };
  // X gives the stacking order bottom to top
  const list = [
    { id: 1, rect: { x: 0, y: 1080, w: 2560, h: 1440 }, states: ['_NET_WM_STATE_MAXIMIZED_VERT', '_NET_WM_STATE_MAXIMIZED_HORZ'], pid: 10, cls: 'firefox' },
    { id: 2, rect: { x: 300, y: 1380, w: 900, h: 600 }, states: [], pid: 20, cls: 'konsole' },
    { id: 3, rect: { x: 100, y: 100, w: 400, h: 300 }, states: [], pid: 30, cls: 'dolphin' }, // on the other monitor
  ];
  const snap = toSnapshot(list, { display, scale: 1, fg: 2 });
  assert.equal(snap.fg, 2);
  assert.deepEqual(snap.wins.map((w) => w.id), [2, 1], 'front first, other monitor dropped');
  assert.deepEqual(snap.wins[0], { id: 2, x: 300, y: 300, w: 900, h: 600, max: false, pid: 20, cls: 'konsole' });
  assert.equal(snap.wins[1].max, true);
  assert.equal(toSnapshot([{ ...list[1], states: ['_NET_WM_STATE_FULLSCREEN'] }], { display, scale: 1, fg: 0 }).wins[0].max, true);
});

test('scale: physical pixels become DIP', () => {
  const snap = toSnapshot([{ id: 7, rect: { x: 300, y: 150, w: 900, h: 600 }, states: [], pid: 1, cls: 'x' }], { display: { x: 0, y: 0, width: 1707, height: 960 }, scale: 1.5, fg: 7 });
  assert.deepEqual([snap.wins[0].x, snap.wins[0].y, snap.wins[0].w, snap.wins[0].h], [200, 100, 600, 400]);
});

test('aiOf: the AI a window belongs to, from its title or class; nothing else gets out', () => {
  const { aiOf } = require('../src/main/platform/linux/window-model');
  assert.equal(aiOf('ChatGPT — Mozilla Firefox', 'firefox'), 'chatgpt');
  assert.equal(aiOf('Google Gemini - Chromium', 'chromium'), 'gemini');
  assert.equal(aiOf('Microsoft Copilot: Your AI companion', 'msedge'), 'copilot');
  assert.equal(aiOf('perplexity.ai', 'firefox'), 'perplexity');
  assert.equal(aiOf('DeepSeek - Into the Unknown', 'firefox'), 'deepseek');
  assert.equal(aiOf('Grok / X', 'firefox'), 'grok');
  assert.equal(aiOf('Le Chat - Mistral AI', 'firefox'), 'lechat');
  assert.equal(aiOf('character.ai | Personalized AI', 'firefox'), 'characterai');
  assert.equal(aiOf('codex', 'konsole'), 'codex');
  assert.equal(aiOf('Claude', 'Claude'), 'claude');
  assert.equal(aiOf('gigs.ts — penguin-api — Visual Studio Code', 'code'), null);
  assert.equal(aiOf('', ''), null);
  assert.equal(aiOf(null, undefined), null);
});
