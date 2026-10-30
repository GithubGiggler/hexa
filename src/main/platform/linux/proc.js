'use strict';

// Which window is Claude's? Claude Code runs the hook, the hook sends its parent's PID, and walking
// up the process tree (hook → shell → claude → terminal or editor) reaches a process that owns a
// window. That window is where you talk to Claude.

const fs = require('node:fs');
const path = require('node:path');

// [pid, parent, grandparent, ...] up to init. /proc/<pid>/stat is "pid (comm) state ppid ...";
// comm can hold spaces and parentheses, so the fields are read after the last ')'.
function parentChain(pid, { root = '/proc', max = 32 } = {}) {
  const chain = [];
  let current = Number(pid);
  while (Number.isInteger(current) && current > 0 && chain.length < max && !chain.includes(current)) {
    chain.push(current);
    let stat;
    try {
      stat = fs.readFileSync(path.join(root, String(current), 'stat'), 'utf8');
    } catch {
      break; // gone, or not ours to read
    }
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    current = Number(fields[1]);
  }
  return chain;
}

// The window of the closest process in the chain that has one, or null.
function windowForChain(chain, wins) {
  for (const pid of chain) {
    const win = wins.find((w) => w.pid === pid);
    if (win) return win;
  }
  return null;
}

module.exports = { parentChain, windowForChain };
