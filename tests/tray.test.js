'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenu } = require('../src/main/tray');
const { trayLabels } = require('../src/main/labels');

const t = trayLabels('en');
const base = { visible: true, scale: 1, muted: false, wander: true, startAtLogin: false, hooks: { installed: false } };
const noop = new Proxy({}, { get: () => () => {} });
const find = (items, label) => items.flatMap((i) => [i, ...(i.submenu || [])]).find((i) => i.label === label);

test('size radio follows the config', () => {
  const menu = buildMenu(base, t, noop);
  const size = find(menu, t.size).submenu;
  assert.deepEqual(size.map((i) => [i.label, i.checked]), [[t.small, false], [t.medium, true], [t.large, false]]);
  const big = buildMenu({ ...base, scale: 1.25 }, t, noop);
  assert.equal(find(big, t.large).checked, true);
});

test('hooks entry reflects their status', () => {
  assert.ok(find(buildMenu(base, t, noop), t.hooksOff));
  const installed = buildMenu({ ...base, hooks: { installed: true } }, t, noop);
  assert.ok(find(installed, t.hooksRemove));
  assert.ok(find(installed, t.hooksOn));
  assert.equal(find(installed, t.hooksOff), undefined);
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
  find(menu, t.hooksOff).click();
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
