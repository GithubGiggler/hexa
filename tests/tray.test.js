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
