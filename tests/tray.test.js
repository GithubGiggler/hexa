'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenu } = require('../src/main/tray');
const { trayLabels } = require('../src/main/labels');

const t = trayLabels('en');
const base = { visible: true, scale: 1, muted: false, wander: true, startAtLogin: false, hooks: { installed: false } };
const noop = new Proxy({}, { get: () => () => {} });
const find = (items, label) => items.flatMap((i) => [i, ...(i.submenu || [])]).find((i) => i.label === label);
// a hooks label as the menu shows it, for the assistant she watches (Claude Code unless told)
const named = (key, name = t.watchClaude) => t[key].replace('{name}', name);

test('size radio follows the config', () => {
  const menu = buildMenu(base, t, noop);
  const size = find(menu, t.size).submenu;
  assert.deepEqual(size.map((i) => [i.label, i.checked]), [[t.small, false], [t.medium, true], [t.large, false]]);
  const big = buildMenu({ ...base, scale: 1.25 }, t, noop);
  assert.equal(find(big, t.large).checked, true);
});

test('hooks entry reflects their status', () => {
  assert.ok(find(buildMenu(base, t, noop), named('hooksOff')));
  assert.equal(named('hooksOff'), 'Install Claude Code hooks');
  const installed = buildMenu({ ...base, hooks: { installed: true } }, t, noop);
  assert.ok(find(installed, named('hooksRemove')));
  assert.ok(find(installed, named('hooksOn')));
  assert.equal(find(installed, named('hooksOff')), undefined);
  const broken = buildMenu({ ...base, hooks: { installed: false, error: 'settings.json is not valid JSON' } }, t, noop);
  assert.ok(broken.some((i) => i.label && i.label.includes('not valid JSON') && i.enabled === false));
});

test('background toggle and checkboxes follow the state; quit is last', () => {
  const menu = buildMenu({ ...base, visible: false, muted: true, startAtLogin: true }, t, noop);
  assert.ok(find(menu, t.show));
  assert.equal(find(menu, t.teleport).enabled, false);
  assert.equal(find(menu, t.mute).checked, true);
  assert.equal(find(menu, t.startup).checked, true);
  assert.equal(menu.at(-1).label, t.quit);
});

test('possess my windows follows the config and toggles', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => (v) => hit.push([k, v]) });
  const on = buildMenu({ ...base, possess: true }, t, act);
  assert.equal(find(on, t.possess).checked, true);
  find(on, t.possess).click();
  assert.deepEqual(hit.at(-1), ['possess', false]);
  assert.equal(find(buildMenu({ ...base, possess: false }, t, act), t.possess).checked, false);
});

test('the status line comes first and is not clickable', () => {
  const menu = buildMenu({ ...base, status: 'Transparency needs a compositor' }, t, noop);
  assert.equal(menu[0].label, 'Transparency needs a compositor');
  assert.equal(menu[0].enabled, false);
});

test('clicks reach their actions', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => () => hit.push(k) });
  const menu = buildMenu(base, t, act);
  find(menu, t.large).click();
  find(menu, named('hooksOff')).click();
  find(menu, t.quit).click();
  assert.deepEqual(hit, ['size', 'installHooks', 'quit']);
});

test('a Screen submenu lists the displays, and following can be turned off', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => (v) => hit.push([k, v]) });
  const displays = [{ id: 11, label: 'Screen 1 (2560×1440)', current: true }, { id: 22, label: 'Screen 2 (1920×1080)', current: false }];
  const menu = buildMenu({ ...base, displays, follow: true }, t, act);
  const screens = find(menu, t.screen).submenu.filter((i) => i.type === 'radio'); // the displays; the follow toggle sits below them
  assert.deepEqual(screens.map((i) => [i.label, i.checked]), [['Screen 1 (2560×1440)', true], ['Screen 2 (1920×1080)', false]]);
  screens[1].click();
  assert.deepEqual(hit.at(-1), ['screen', 22]);
  assert.equal(find(menu, t.follow).checked, true);
  find(menu, t.follow).click();
  assert.deepEqual(hit.at(-1), ['follow', false]);
});

test('toModel: her menu as plain data, and run(id) does what the item does', () => {
  const { toModel } = require('../src/main/tray');
  const did = [];
  const template = [
    { label: 'Online', enabled: false },
    { type: 'separator' },
    { label: 'Teleport', click: () => did.push('teleport') },
    { label: 'Size', submenu: [{ label: 'Small', type: 'radio', checked: true, click: () => did.push('small') }] },
    { label: 'Mute', type: 'checkbox', checked: false, click: () => did.push('mute') },
    { label: 'Off', enabled: false, click: () => did.push('never') },
  ];
  const { items, run } = toModel(template);
  assert.deepEqual(items.map((i) => i.type), ['normal', 'separator', 'normal', 'submenu', 'checkbox', 'normal']);
  assert.equal(items[0].enabled, false);
  assert.equal(items[3].submenu[0].type, 'radio');
  assert.equal(items[3].submenu[0].checked, true);
  assert.equal(JSON.stringify(items).includes('function'), false);
  assert.equal(run(items[2].id), true);
  assert.equal(run(items[3].submenu[0].id), true);
  assert.equal(run(items[5].id), false, 'a disabled item does nothing');
  assert.equal(run('nope'), false);
  assert.deepEqual(did, ['teleport', 'small']);
});

test('Usage and stats opens the stats window, whether she is out or in the background', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => () => hit.push(k) });
  for (const visible of [true, false]) {
    const item = find(buildMenu({ ...base, visible }, t, act), t.stats);
    assert.equal(item.label, 'Usage and stats');
    assert.notEqual(item.enabled, false);
    item.click();
  }
  assert.deepEqual(hit, ['stats', 'stats']);
});

test('Watch: a radio for each assistant, the watched one checked; a click asks to watch it', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => (v) => hit.push([k, v]) });
  const menu = buildMenu(base, t, act);
  const watch = find(menu, t.watch).submenu;
  assert.deepEqual(watch.map((i) => [i.label, i.type, i.checked]), [
    ['Claude Code', 'radio', true], ['Codex', 'radio', false], ['Antigravity', 'radio', false],
  ]);
  watch[1].click();
  watch[2].click();
  assert.deepEqual(hit, [['watch', 'codex'], ['watch', 'agy']]);
  const codex = find(buildMenu({ ...base, assistant: 'codex' }, t, act), t.watch).submenu;
  assert.deepEqual(codex.map((i) => i.checked), [false, true, false]);
});

test('an assistant she doesn’t know counts as Claude Code', () => {
  const menu = buildMenu({ ...base, assistant: 'cursor' }, t, noop);
  assert.deepEqual(find(menu, t.watch).submenu.map((i) => i.checked), [true, false, false]);
  assert.ok(find(menu, named('hooksOff')));
});

test('the hooks items are the watched assistant’s; answering permissions is Claude Code’s alone', () => {
  const hit = [];
  const act = new Proxy({}, { get: (_, k) => () => hit.push(k) });
  const off = buildMenu({ ...base, assistant: 'codex' }, t, act);
  assert.ok(find(off, 'Install Codex hooks'));
  assert.equal(find(off, named('hooksOff')), undefined);
  assert.equal(find(off, t.permissions), undefined);
  find(off, 'Install Codex hooks').click();
  const on = buildMenu({ ...base, assistant: 'agy', hooks: { installed: true } }, t, act);
  assert.equal(find(on, 'Antigravity hooks: installed').enabled, false);
  find(on, 'Remove Antigravity hooks').click();
  assert.deepEqual(hit, ['installHooks', 'removeHooks']);
  assert.ok(find(buildMenu(base, t, noop), t.permissions), 'still there for Claude Code');
  const broken = buildMenu({ ...base, assistant: 'codex', hooks: { installed: false, error: 'hooks.json is not valid JSON' } }, t, noop);
  assert.ok(broken.some((i) => i.label === 'Codex settings: hooks.json is not valid JSON' && i.enabled === false));
});

test('a warning from the assistant’s own settings shows under its hooks, not clickable', () => {
  const warning = 'Codex has hooks turned off in /x/config.toml ([features] hooks = false)';
  const menu = buildMenu({ ...base, assistant: 'codex', hooks: { installed: true, warning } }, t, noop);
  const i = menu.findIndex((m) => m.label === warning);
  assert.ok(i > 0);
  assert.equal(menu[i].enabled, false);
  assert.equal(menu[i - 1].label, 'Remove Codex hooks');
});
