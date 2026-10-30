import test from 'node:test';
import assert from 'node:assert/strict';
import { Guide } from '../src/renderer/js/guide.js';
import { linesFor } from '../src/renderer/js/lines/index.js';

// Stand-ins: the panel records what she shows and lets the test click its buttons.
function rig({ installed = false, claudeWin = null, newWin = null, tray = [2300, 0, 240, 30] } = {}) {
  const shown = [];
  const calls = [];
  const panel = {
    say(msg) { shown.push(msg); return shown.length; },
  };
  const hexa = {
    canPoint: () => true,
    pointAt: (rect, opts) => { calls.push(['pointAt', rect, opts]); return Promise.resolve(true); },
    stopPointing: () => calls.push(['stopPointing']),
  };
  let wins = [];
  const brain = {
    get windows() { return { fg: 0, wins }; },
    claudeWindow: () => claudeWin,
  };
  const host = {
    hooksStatus: async () => ({ installed }),
    installHooks: async () => { calls.push(['installHooks']); return { ok: true }; },
    openClaudeFolder: async () => { calls.push(['openClaudeFolder']); if (newWin) wins = [newWin, ...wins]; return true; },
    trayPlace: async () => tray,
  };
  const guide = new Guide({ hexa, panel, host, brain, lines: () => linesFor('en'), wait: () => Promise.resolve() });
  // click a button on the latest panel, once it's up
  const click = async (id) => {
    for (let i = 0; i < 50 && !shown.at(-1)?.onAction; i++) await Promise.resolve();
    shown.at(-1).onAction(id);
    await new Promise((r) => setImmediate(r));
  };
  return { guide, shown, calls, click };
}

test('the welcome offers to plug her in, and plugging in installs the hooks', async () => {
  const { guide, shown, calls, click } = rig();
  const done = guide.welcome();
  await click('connect');
  assert.ok(calls.some((c) => c[0] === 'installHooks'));
  assert.equal(shown.at(-1).kind, 'done');
  await click('ok');
  await done;
  assert.ok(shown[0].actions.some((a) => a.id === 'connect' && a.primary));
});

test('the menu lists what she can show, with "plug me in" first while the hooks are missing', async () => {
  const { guide, shown, click } = rig();
  const done = guide.menu();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(shown[0].actions.map((a) => a.id), ['connect', 'claude', 'folder', 'icon', 'close']);
  await click('close');
  await done;
  const installed = rig({ installed: true });
  const d2 = installed.guide.menu();
  await new Promise((r) => setImmediate(r));
  assert.ok(!installed.shown[0].actions.some((a) => a.id === 'connect'));
  await installed.click('close');
  await d2;
});

test("where's Claude: she points at its window, then lets go", async () => {
  const win = { id: 55, x: 100, y: 100, w: 800, h: 600 };
  const { guide, calls, click } = rig({ claudeWin: win });
  const done = guide.claude();
  await click('ok');
  await done;
  const p = calls.find((c) => c[0] === 'pointAt');
  assert.equal(p[1].id, 55);
  assert.equal(p[2].label, 'CLAUDE');
  assert.ok(calls.some((c) => c[0] === 'stopPointing'));
});

test("where's Claude, before she has seen it: she says so, nothing to point at", async () => {
  const { guide, calls, shown, click } = rig();
  const done = guide.claude();
  await click('ok');
  await done;
  assert.ok(!calls.some((c) => c[0] === 'pointAt'));
  assert.match(shown[0].line, /haven't seen Claude/);
});

test("Claude's folder: she opens it and points at the file manager window that appears", async () => {
  const fm = { id: 77, x: 300, y: 200, w: 900, h: 600 };
  const { guide, calls, click } = rig({ newWin: fm });
  const done = guide.folder();
  await click('ok');
  await done;
  assert.ok(calls.some((c) => c[0] === 'openClaudeFolder'));
  assert.equal(calls.find((c) => c[0] === 'pointAt')[1].id, 77);
});

test("where's my icon: she points at the tray in your panel", async () => {
  const { guide, calls, click } = rig();
  const done = guide.icon();
  await click('ok');
  await done;
  assert.deepEqual(calls.find((c) => c[0] === 'pointAt')[1], { x: 2300, y: 0, w: 240, h: 30 });
});

test('a panel that cannot show (an alert is up) ends the scene quietly', async () => {
  const { guide, calls } = rig({ claudeWin: { id: 1, x: 0, y: 0, w: 500, h: 400 } });
  guide.panel.say = () => null;
  await guide.claude();
  assert.ok(calls.some((c) => c[0] === 'stopPointing'));
});

test('the guide speaks in her own words', () => {
  const g = linesFor('en').guide;
  for (const [k, v] of Object.entries(g)) {
    const all = typeof v === 'string' ? [v] : Object.values(v);
    for (const text of all) assert.ok(!/capri/i.test(text), k);
  }
});
