'use strict';

// Rectangle and display helpers for the overlay. Rects are [x, y, w, h].

// DIP to physical pixels, rounded outward so a hit area never shrinks; empty rects are dropped.
function toPhysical(rects, scale) {
  const out = [];
  for (const [x, y, w, h] of rects) {
    if (!(w > 0 && h > 0)) continue;
    const x0 = Math.floor(x * scale);
    const y0 = Math.floor(y * scale);
    out.push([x0, y0, Math.ceil((x + w) * scale) - x0, Math.ceil((y + h) * scale) - y0]);
  }
  return out;
}

const union = (a, b) => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};
const area = (r) => r[2] * r[3];
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// Overlapping rects are joined; then, while there are more than max, the pair whose union adds
// the least extra area is joined. Everything that was covered stays covered.
function mergeRects(rects, max = 16) {
  let list = rects.filter((r) => r[2] > 0 && r[3] > 0).map((r) => [...r]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i], list[j])) {
          list[i] = union(list[i], list[j]);
          list.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  while (list.length > max) {
    let best = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const u = union(list[i], list[j]);
        const cost = area(u) - area(list[i]) - area(list[j]);
        if (!best || cost < best.cost) best = { i, j, u, cost };
      }
    }
    list[best.i] = best.u;
    list.splice(best.j, 1);
  }
  return list;
}

// The display Hexa should be on: the one asked for, else the primary, else any.
function chooseDisplay(displays, wantedId, primaryId) {
  return displays.find((d) => d.id === wantedId) || displays.find((d) => d.id === primaryId) || displays[0];
}

// Where two displays touch: { side (of a), from, to } along that side, or null if they don't.
// Displays are { x, y, width, height }.
function sharedEdge(a, b) {
  const overlap = (a0, a1, b0, b1) => (Math.min(a1, b1) > Math.max(a0, b0) ? [Math.max(a0, b0), Math.min(a1, b1)] : null);
  const span = (side, range) => (range ? { side, from: range[0], to: range[1] } : null);
  if (b.y + b.height === a.y) return span('top', overlap(a.x, a.x + a.width, b.x, b.x + b.width));
  if (a.y + a.height === b.y) return span('bottom', overlap(a.x, a.x + a.width, b.x, b.x + b.width));
  if (a.x + a.width === b.x) return span('right', overlap(a.y, a.y + a.height, b.y, b.y + b.height));
  if (b.x + b.width === a.x) return span('left', overlap(a.y, a.y + a.height, b.y, b.y + b.height));
  return null;
}

function rectsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((r, i) => r.length === b[i].length && r.every((v, k) => v === b[i][k]));
}

module.exports = { toPhysical, mergeRects, chooseDisplay, rectsEqual, sharedEdge };
