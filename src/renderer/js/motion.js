// Where she can be and how she moves there: pure helpers, no drawing, no clocks.
// A position is her root (the point she hovers above), in overlay coordinates; size is her box,
// w wide centred on x, h tall above y.

const MARGIN = 24;

export const restSpot = (area, size) => ({ x: area.x + area.w - MARGIN - size.w / 2, y: area.y + area.h - MARGIN });

// Spots she drifts between when nothing's going on.
export function corners(area, size) {
  const left = area.x + MARGIN + size.w / 2;
  const right = area.x + area.w - MARGIN - size.w / 2;
  const low = area.y + area.h - MARGIN;
  const mid = area.y + Math.max(size.h + MARGIN, area.h * 0.5);
  return [{ x: right, y: low }, { x: left, y: low }, { x: right, y: mid }, { x: left, y: mid }];
}

export function clampInto(area, pos, size) {
  const minX = area.x + size.w / 2;
  const maxX = area.x + area.w - size.w / 2;
  const minY = area.y + size.h;
  const maxY = area.y + area.h;
  return {
    x: Math.min(Math.max(pos.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(pos.y, minY), Math.max(minY, maxY)),
  };
}

// Half hidden behind the left or right edge, or hanging upside down from the top.
export function peekSpots(area, size) {
  const y = area.y + area.h * 0.55 + size.h / 2;
  return [
    { side: 'left', x: area.x + size.w * 0.12, y, dir: 1 },
    { side: 'right', x: area.x + area.w - size.w * 0.12, y, dir: -1 },
    { side: 'top', x: area.x + area.w * 0.35, y: area.y + 6, dir: 1 },
  ];
}

// One step of a fall; it lands exactly on the floor.
export function fallStep({ y, vy }, dt, floorY, g = 2600) {
  const v = vy + g * dt;
  const next = y + v * dt;
  if (next >= floorY) return { y: floorY, vy: 0, landed: true };
  return { y: next, vy: v, landed: false };
}

export function nextDriftTarget(area, size, current, rnd = Math.random) {
  const options = corners(area, size).filter((c) => Math.hypot(c.x - current.x, c.y - current.y) > 50);
  const list = options.length ? options : corners(area, size);
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}
