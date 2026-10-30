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

// ---- being thrown (rebuilt from the spec, not upstream code) ----

const GRAVITY = 2600;
const CRASH_V = 1200;      // into a screen edge faster than this: she crashes and sticks a moment
const STUCK_S = 0.4;
const CATCH_V = 1400;      // onto a window ledge slower than this: it catches her
const UPRIGHT_SPIN = 3;    // landing spinning slower than this (rad/s): on her feet
const STEP = 1 / 120;
const MAX_DT = 0.1;

// One step of a flight. state { x, y, vx, vy, spin, stuck?, after? }: her root, in px and px/s.
// ledges: window top edges [{ id, x, y, w }]; hipDy: from her hips down to her root.
// Returns { state, events }: events are { type: 'crash'|'bounce', side }, { type: 'ledge', id,
// caught }, { type: 'floor', upright }. state.done once she's caught or down.
export function flightStep(state, dt, { area, size, ledges = [], hipDy = 66 }) {
  let s = { ...state };
  const events = [];
  const total = Math.min(MAX_DT, Math.max(0, dt || 0));
  const floor = area.y + area.h;
  const left = area.x + size.w / 2;
  const right = area.x + area.w - size.w / 2;
  const top = area.y + size.h;
  for (let t = 0; t < total - 1e-9 && !s.done; t += STEP) {
    const h = Math.min(STEP, total - t);
    if (s.stuck > 0) {
      s.stuck -= h;
      if (s.stuck <= 0) {
        s.vx = s.after.vx;
        s.vy = s.after.vy;
        s.stuck = 0;
      }
      continue;
    }
    const hipBefore = s.y - hipDy;
    s.vy += GRAVITY * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.spin *= 1 - 0.3 * h;
    // the sides of the screen
    for (const [side, edge, past] of [['left', left, s.x < left], ['right', right, s.x > right]]) {
      if (!past) continue;
      s.x = edge;
      if (Math.abs(s.vx) > CRASH_V) {
        events.push({ type: 'crash', side });
        s.after = { vx: -s.vx * 0.45, vy: s.vy * 0.3 };
        s.vx = 0;
        s.vy = 0;
        s.stuck = STUCK_S;
      } else {
        events.push({ type: 'bounce', side });
        s.vx = -s.vx * 0.5;
      }
    }
    if (s.y < top) {
      s.y = top;
      s.vy = -s.vy * 0.4;
      events.push({ type: 'bounce', side: 'top' });
    }
    // a window ledge on the way down
    const hipAfter = s.y - hipDy;
    if (s.vy > 0) {
      const ledge = ledges.find((l) => l.y >= hipBefore && l.y <= hipAfter && s.x >= l.x + 40 && s.x <= l.x + l.w - 40);
      if (ledge) {
        const caught = s.vy < CATCH_V;
        events.push({ type: 'ledge', id: ledge.id, caught });
        if (caught) {
          s.y = ledge.y + hipDy;
          s.done = true;
          break;
        }
        s.y = ledge.y + hipDy - 1;
        s.vy = -s.vy * 0.35;
      }
    }
    if (s.y >= floor) {
      s.y = floor;
      events.push({ type: 'floor', upright: Math.abs(s.spin) < UPRIGHT_SPIN });
      s.done = true;
    }
  }
  return { state: s, events };
}
