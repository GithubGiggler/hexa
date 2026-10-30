// Her menu, the one a right-click on her opens: drawn by her in the overlay (main sends it as plain
// data from the same template as the tray's, see toModel in tray.js). While it's open the overlay
// takes the whole screen's clicks, so a click anywhere else closes it instead of going through,
// and main grabs Escape, the arrows and Enter for it. Labels only ever go in as text.

const GAP = 2;

// Where a menu of size goes for a pointer at `at`: down and right of it, flipped when there's no
// room, always inside area. For a submenu, `item` is the row it opens from: it opens beside it.
export function placeMenu(at, size, area, item = null) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let x = at.x;
  if (x + size.w > area.x + area.w) x = item ? item.x - size.w : at.x - size.w;
  let y = at.y;
  if (y + size.h > area.y + area.h) y = item ? item.y + item.h - size.h : at.y - size.h;
  return { x: clamp(x, area.x, area.x + area.w - size.w), y: clamp(y, area.y, area.y + area.h - size.h) };
}

const pickable = (item) => item && item.type !== 'separator' && item.enabled !== false;

// The index of the next item the arrow keys land on from `from` going `dir` (1 down, -1 up),
// skipping separators and disabled items and wrapping round; -1 when there's none.
export function nextItem(items, from, dir) {
  const n = items.length;
  const start = from < 0 ? (dir > 0 ? -1 : n) : from; // nothing picked yet: from the top or bottom
  for (let step = 1; step <= n; step++) {
    const i = (((start + dir * step) % n) + n) % n;
    if (pickable(items[i])) return i;
  }
  return -1;
}

export class Menu {
  constructor({ doc = document, root, onPick = () => {}, onClose = () => {} }) {
    this.doc = doc;
    this.root = root;
    this.onPick = onPick;
    this.onClose = onClose;
    this.open = false;
    this.area = { x: 0, y: 0, w: 0, h: 0 };
    this.screen = this.area;
    this.levels = []; // [{ items, box, rows, active }], the root menu first, then open submenus

    this.layer = doc.createElement('div');
    this.layer.className = 'menu-layer';
    this.layer.hidden = true;
    // a click anywhere outside her menu closes it (and goes no further)
    this.layer.addEventListener('pointerdown', (e) => {
      if (e.target === this.layer) this.close();
    });
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(this.layer);
  }

  // area: where it may go; screen: all of the overlay, whose clicks it takes while open
  show(items, at, area, screen = area) {
    this.close(false);
    this.area = area;
    this.screen = screen;
    this.open = true;
    this.layer.hidden = false;
    this.addLevel(items, at, null);
  }

  // Closes it; tells main unless it was main asking (a pick, or showing a new one).
  close(tell = true) {
    if (!this.open) return;
    this.open = false;
    for (const level of this.levels) level.box.remove();
    this.levels = [];
    this.layer.hidden = true;
    if (tell) this.onClose();
  }

  // The whole screen while open, so outside clicks reach her; nothing otherwise.
  rects() {
    return this.open ? [[this.screen.x, this.screen.y, this.screen.w, this.screen.h]] : [];
  }

  addLevel(items, at, fromRow) {
    const box = this.doc.createElement('div');
    box.className = 'menu';
    const level = { items, box, rows: [], active: -1 };
    items.forEach((item, i) => {
      if (item.type === 'separator') {
        const sep = this.doc.createElement('div');
        sep.className = 'menu-sep';
        box.appendChild(sep);
        level.rows.push(sep);
        return;
      }
      const row = this.doc.createElement('div');
      row.className = `menu-item${item.enabled === false ? ' off' : ''}`;
      const mark = this.doc.createElement('span');
      mark.className = 'menu-mark';
      if (item.type === 'checkbox' && item.checked) mark.textContent = '✓';
      if (item.type === 'radio' && item.checked) mark.textContent = '●';
      const label = this.doc.createElement('span');
      label.className = 'menu-label';
      label.textContent = String(item.label ?? '');
      row.append(mark, label);
      if (item.type === 'submenu') {
        const arrow = this.doc.createElement('span');
        arrow.className = 'menu-arrow';
        arrow.textContent = '›';
        row.appendChild(arrow);
      }
      row.addEventListener('pointerenter', () => this.hover(level, i));
      row.addEventListener('click', () => this.activate(level, i));
      box.appendChild(row);
      level.rows.push(row);
    });
    this.layer.appendChild(box);
    const size = { w: box.offsetWidth, h: box.offsetHeight };
    const p = placeMenu(at, size, this.area, fromRow);
    box.style.left = `${p.x}px`;
    box.style.top = `${p.y}px`;
    this.levels.push(level);
    return level;
  }

  depth(level) {
    return this.levels.indexOf(level);
  }

  // closes the submenus deeper than level
  trim(level) {
    const d = this.depth(level);
    for (const deeper of this.levels.splice(d + 1)) deeper.box.remove();
  }

  hover(level, i) {
    this.highlight(level, i);
    const item = level.items[i];
    this.trim(level);
    if (item.type === 'submenu' && item.enabled !== false) this.openSub(level, i);
  }

  highlight(level, i) {
    level.rows[level.active]?.classList?.remove('on');
    level.active = i;
    level.rows[i]?.classList?.add('on');
  }

  openSub(level, i) {
    const r = level.rows[i].getBoundingClientRect();
    const row = { x: r.left, y: r.top, w: r.width, h: r.height };
    const sub = this.addLevel(level.items[i].submenu, { x: r.left + r.width + GAP, y: r.top }, row);
    return sub;
  }

  activate(level, i) {
    const item = level.items[i];
    if (!pickable(item)) return;
    if (item.type === 'submenu') {
      this.trim(level);
      const sub = this.openSub(level, i);
      this.highlight(sub, nextItem(sub.items, -1, 1));
      return;
    }
    this.close(false);
    this.onPick(item.id);
  }

  // A key main grabbed for her menu: Escape, Up, Down, Left, Right, Return.
  key(name) {
    if (!this.open) return;
    const level = this.levels[this.levels.length - 1];
    if (name === 'Escape') {
      if (this.levels.length > 1) this.trim(this.levels[this.levels.length - 2]);
      else this.close();
    } else if (name === 'Up' || name === 'Down') {
      const i = nextItem(level.items, level.active, name === 'Down' ? 1 : -1);
      if (i >= 0) {
        this.highlight(level, i);
        this.trim(level);
      }
    } else if (name === 'Right') {
      if (level.items[level.active]?.type === 'submenu') this.activate(level, level.active);
    } else if (name === 'Left') {
      if (this.levels.length > 1) this.trim(this.levels[this.levels.length - 2]);
    } else if (name === 'Return' && level.active >= 0) {
      this.activate(level, level.active);
    }
  }
}
