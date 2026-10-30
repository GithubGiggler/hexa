'use strict';

// How close you two are: points from days together (ten minutes with her makes a day), chats and
// the Claude tasks she watched finish, each capped per day so it grows over weeks, not an
// afternoon. Five stages, with her own names. A new one is announced once (onStage).

const fs = require('node:fs');
const path = require('node:path');

const STAGES = [[0, 'Unknown host'], [40, 'Handshake'], [150, 'Connected'], [400, 'Trusted'], [900, 'root']];
const DAILY = { chat: [2, 20], task: [1, 20], reminder: [3, 9] }; // points each, most points a day
const DAY_MINUTES = 10;
const DAY_POINTS = 10;

function stageOf(points) {
  let i = 0;
  while (i + 1 < STAGES.length && points >= STAGES[i + 1][0]) i++;
  return { index: i, name: STAGES[i][1], next: STAGES[i + 1] ? { name: STAGES[i + 1][1], at: STAGES[i + 1][0] } : null };
}

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function createBond({ file, now = Date.now, onStage = () => {} }) {
  let data = { points: 0, days: 0, day: '', today: {} };
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch { /* a fresh start */ }
  let dirty = false;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data));
    fs.renameSync(temp, file);
    dirty = false;
  };
  const today = () => {
    const k = dayKey(now());
    if (data.day !== k) {
      data.day = k;
      data.today = {};
    }
    return data.today;
  };
  const add = (n) => {
    const before = stageOf(data.points).index;
    data.points += n;
    dirty = true;
    const after = stageOf(data.points);
    if (after.index > before) onStage(after);
  };
  return {
    // kind: 'minutes' (with n), 'chat', 'task', 'reminder'
    credit(kind, n = 1) {
      const t = today();
      if (kind === 'minutes') {
        t.minutes = (t.minutes || 0) + n;
        if (t.minutes >= DAY_MINUTES && !t.counted) {
          t.counted = true;
          data.days += 1;
          add(DAY_POINTS);
        }
        dirty = true;
        return;
      }
      const rule = DAILY[kind];
      if (!rule) return;
      const [each, max] = rule;
      const got = t[kind] || 0;
      const give = Math.min(each, max - got);
      if (give <= 0) return;
      t[kind] = got + give;
      add(give);
    },
    points: () => data.points,
    days: () => data.days,
    stage: () => stageOf(data.points),
    flush() {
      if (dirty) save();
    },
  };
}

module.exports = { createBond, stageOf, STAGES };
