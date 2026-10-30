'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readings, troubles, startSense } = require('../src/main/platform/linux/sense');

test('readings from /proc and /sys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-sense-'));
  const mk = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  mk('proc/meminfo', 'MemTotal:       16000000 kB\nMemFree:  100 kB\nMemAvailable:    800000 kB\n');
  mk('sys/class/power_supply/AC/type', 'Mains');
  mk('sys/class/power_supply/BAT0/type', 'Battery');
  mk('sys/class/power_supply/BAT0/capacity', '12');
  mk('sys/class/power_supply/BAT0/status', 'Discharging');
  mk('sys/class/thermal/thermal_zone0/temp', '45000');
  mk('sys/class/thermal/thermal_zone1/temp', '93500');
  const r = readings({ sys: path.join(root, 'sys'), proc: path.join(root, 'proc'), cpus: 8, loadavg: () => [8.4, 0, 0] });
  assert.equal(r.memFree, 0.05);
  assert.deepEqual(r.battery, { percent: 12, draining: true });
  assert.equal(r.temp, 93.5);
  assert.ok(r.load > 1);
});

test('trouble: the CPU only after it stays pegged, the rest at once', () => {
  const state = {};
  const hot = { load: 1.2, memFree: 0.5, battery: null, temp: 50 };
  assert.deepEqual(troubles(hot, state), []);
  assert.deepEqual(troubles(hot, state).map((t) => t.kind), ['cpu']);
  assert.deepEqual(troubles({ load: 0.1, memFree: 0.03, battery: { percent: 9, draining: true }, temp: 95 }, state).map((t) => t.kind), ['memory', 'battery', 'hot']);
  assert.deepEqual(troubles({ load: 0.1, memFree: 0.5, battery: { percent: 9, draining: false }, temp: 40 }, state), [], 'charging is fine');
});

test('each kind at most once per half hour', () => {
  let t = 0;
  const said = [];
  const s = startSense({ onTrouble: (x) => said.push(x.kind), read: () => ({ load: 0, memFree: 0.01, battery: null, temp: null }), now: () => t, every: 1e9 });
  s.tick(); t += 60000; s.tick(); t += 30 * 60000; s.tick();
  s.stop();
  assert.deepEqual(said, ['memory', 'memory']);
});
