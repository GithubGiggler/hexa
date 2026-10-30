'use strict';

// She feels her machine: every 30 s, the load per CPU, free memory, the battery and the hottest
// thermal zone, from /proc and /sys. When one is in trouble she says so, at most once per half an
// hour for each kind: the CPU pegged for a minute, memory nearly gone, the battery low and
// draining, a zone over 90 °C.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVERY_MS = 30 * 1000;
const QUIET_MS = 30 * 60 * 1000;

const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    return null;
  }
};

function readings({ sys = '/sys', proc = '/proc', cpus = os.cpus().length, loadavg = os.loadavg } = {}) {
  const out = { load: loadavg()[0] / Math.max(1, cpus), memFree: null, battery: null, temp: null };
  const mem = read(path.join(proc, 'meminfo'));
  if (mem) {
    const kb = (k) => Number((mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]);
    const total = kb('MemTotal');
    const avail = kb('MemAvailable');
    if (total && Number.isFinite(avail)) out.memFree = avail / total;
  }
  const ps = path.join(sys, 'class', 'power_supply');
  for (const name of (() => { try { return fs.readdirSync(ps); } catch { return []; } })()) {
    if (read(path.join(ps, name, 'type')) !== 'Battery') continue;
    const cap = Number(read(path.join(ps, name, 'capacity')));
    if (Number.isFinite(cap)) out.battery = { percent: cap, draining: read(path.join(ps, name, 'status')) === 'Discharging' };
    break;
  }
  const th = path.join(sys, 'class', 'thermal');
  for (const name of (() => { try { return fs.readdirSync(th); } catch { return []; } })()) {
    const t = Number(read(path.join(th, name, 'temp'))) / 1000;
    if (Number.isFinite(t) && t > 0 && t < 150 && (out.temp === null || t > out.temp)) out.temp = t;
  }
  return out;
}

// What's worth telling you about, given the readings and how long the CPU has been pegged.
function troubles(r, state) {
  const found = [];
  state.busy = r.load > 0.95 ? (state.busy || 0) + 1 : 0;
  if (state.busy >= 2) found.push({ kind: 'cpu', load: Math.round(r.load * 100) });
  if (r.memFree !== null && r.memFree < 0.06) found.push({ kind: 'memory', free: Math.round(r.memFree * 100) });
  if (r.battery && r.battery.draining && r.battery.percent <= 15) found.push({ kind: 'battery', percent: r.battery.percent });
  if (r.temp !== null && r.temp >= 90) found.push({ kind: 'hot', temp: Math.round(r.temp) });
  return found;
}

function startSense({ onTrouble, read: readFn = readings, now = Date.now, every = EVERY_MS }) {
  const state = { busy: 0 };
  const last = {};
  const tick = () => {
    for (const t of troubles(readFn(), state)) {
      if (t.kind in last && now() - last[t.kind] < QUIET_MS) continue;
      last[t.kind] = now();
      onTrouble(t);
    }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { startSense, readings, troubles };
