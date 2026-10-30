'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBond, stageOf, STAGES } = require('../src/main/bond');

const DAY = 24 * 3600 * 1000;
function rig(start = new Date(2026, 9, 29, 9).getTime()) {
  let t = start;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-bond-')), 'bond.json');
  const ups = [];
  const make = () => createBond({ file, now: () => t, onStage: (s) => ups.push(s.name) });
  return { make, bond: make(), ups, advance: (ms) => { t += ms; }, file };
}

test('five stages, with her names', () => {
  assert.deepEqual(STAGES.map((s) => s[1]), ['Unknown host', 'Handshake', 'Connected', 'Trusted', 'root']);
  assert.equal(stageOf(0).name, 'Unknown host');
  assert.equal(stageOf(150).name, 'Connected');
  assert.equal(stageOf(10000).name, 'root');
  assert.equal(stageOf(10000).next, null);
});

test('a day together counts once she\'s been with you ten minutes of it', () => {
  const { bond } = rig();
  bond.credit('minutes', 9);
  assert.equal(bond.points(), 0);
  bond.credit('minutes', 1);
  assert.equal(bond.points(), 10);
  bond.credit('minutes', 60);
  assert.equal(bond.points(), 10, 'once a day');
});

test('chats and Claude\'s finished tasks count, but only so much a day', () => {
  const { bond, advance } = rig();
  for (let i = 0; i < 50; i++) bond.credit('chat');
  for (let i = 0; i < 50; i++) bond.credit('task');
  assert.equal(bond.points(), 20 + 20);
  advance(DAY);
  bond.credit('chat');
  assert.equal(bond.points(), 42, 'a new day, a new allowance');
});

test('a new stage is announced once, and it all survives a restart', () => {
  const r = rig();
  for (let i = 0; i < 20; i++) r.bond.credit('task');
  for (let i = 0; i < 10; i++) r.bond.credit('chat');
  assert.deepEqual(r.ups, ['Handshake']);
  r.bond.flush();
  const again = r.make();
  assert.equal(again.points(), 40);
  assert.equal(again.stage().name, 'Handshake');
});
