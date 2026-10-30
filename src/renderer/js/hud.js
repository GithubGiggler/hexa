// The sessions HUD: with two or more Claude sessions going, a column of chips in the top right
// corner, one per session (a state light, the project, what it's doing, how long). The ticker over
// her head still follows the one that matters most. A click on a chip makes her point at that
// session's window and bring you its last answer. Everything in it goes in as text.

const STALE_MS = 30 * 60 * 1000;     // no events for this long: the session is gone
const DONE_MS = 10 * 60 * 1000;      // "done" for this long after it finished, then idle
const THINKING_MS = 15 * 1000;       // working, but nothing for this long: thinking
const ORDER = { waiting: 0, error: 1, working: 2, thinking: 2, done: 3, idle: 4 };

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function stateOf(s, now) {
  if (s.waiting) return 'waiting';
  if (s.working && s.error) return 'error';
  if (s.working) return now - s.seen > THINKING_MS ? 'thinking' : 'working';
  if (s.doneAt && now - s.doneAt < DONE_MS) return 'done';
  return 'idle';
}

// The brain's sessions as HUD rows, the one that needs you first.
export function sessionRows(sessions, now) {
  const rows = [];
  for (const s of sessions) {
    if (now - (s.seen ?? 0) > STALE_MS) continue;
    const state = stateOf(s, now);
    const label = state === 'waiting' ? 'WAITING for you'
      : state === 'thinking' ? 'THINKING'
        : s.last && (state === 'working' || state === 'error') ? `${s.last.verb} ${s.last.target}`.trim()
          : state === 'done' ? 'DONE' : 'IDLE';
    const elapsed = s.working && s.taskStart !== null ? clock(now - s.taskStart)
      : state === 'done' && s.lastDuration ? clock(s.lastDuration) : '';
    rows.push({ id: s.id, project: s.title || s.project, state, label, elapsed, seen: s.seen ?? 0 });
  }
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.seen - a.seen);
}

export class Hud {
  constructor({ doc = document, root, onPick = () => {} }) {
    this.doc = doc;
    this.onPick = onPick;
    this.box = doc.createElement('div');
    this.box.className = 'hud';
    this.box.hidden = true;
    root.appendChild(this.box);
    this.key = '';
  }

  update(rows) {
    const show = rows.length >= 2;
    const key = show ? JSON.stringify(rows.map((r) => [r.id, r.project, r.state, r.label, r.elapsed])) : '';
    if (key === this.key) return;
    this.key = key;
    this.box.hidden = !show;
    if (!show) {
      this.box.replaceChildren();
      return;
    }
    this.box.replaceChildren(...rows.map((r) => this.chip(r)));
  }

  chip(r) {
    const el = (tag, className, text) => {
      const n = this.doc.createElement(tag);
      n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const chip = el('div', `hud-chip ${r.state}`);
    const top = el('div', 'hud-top');
    top.append(el('span', 'hud-led'), el('span', 'hud-project', r.project), el('span', 'hud-time', r.elapsed));
    chip.append(top, el('div', 'hud-label', r.label));
    chip.addEventListener('click', () => this.onPick(r.id));
    return chip;
  }

  // where clicks must reach it (the overlay passes everything else through)
  rects() {
    if (this.box.hidden) return [];
    const b = this.box.getBoundingClientRect();
    return [[b.left, b.top, b.width, b.height]];
  }
}

