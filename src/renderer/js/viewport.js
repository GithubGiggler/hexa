// Hexa doesn't cover your screen: she lives in a small window that follows her. Everything is
// computed in the display's coordinates; her window is a viewport onto them. This decides when
// that viewport has to move or resize: only when what she's drawing leaves it (with slack, so the
// window moves in occasional steps, not every frame), or when it's been much bigger than needed for
// a moment (after an effect).

// The box around a set of [x, y, w, h] rects, grown by margin; null for none.
export function contentBox(rects, margin = 0) {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r[0])) - margin;
  const y0 = Math.min(...rects.map((r) => r[1])) - margin;
  const x1 = Math.max(...rects.map((r) => r[0] + r[2])) + margin;
  const y1 = Math.max(...rects.map((r) => r[1] + r[3])) + margin;
  return [x0, y0, x1 - x0, y1 - y0];
}

const contains = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1]
  && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];

export class Viewport {
  constructor({ slack = 80, min = 64, shrinkAfterMs = 700, shrinkRatio = 2.25 } = {}) {
    this.slack = slack;
    this.min = min;
    this.shrinkAfterMs = shrinkAfterMs;
    this.shrinkRatio = shrinkRatio;
    this.current = null;   // what the main process last applied
    this.pending = false;  // a request is on its way
    this.loose = null;     // since when the viewport has been much bigger than needed
  }

  fit(content) {
    const x = Math.floor(content[0] - this.slack);
    const y = Math.floor(content[1] - this.slack);
    const w = Math.max(this.min, Math.ceil(content[0] + content[2] + this.slack) - x);
    const h = Math.max(this.min, Math.ceil(content[1] + content[3] + this.slack) - y);
    return [x, y, w, h];
  }

  // The viewport to ask for now, or null to keep the current one.
  want(content, now) {
    if (!content || this.pending) return null;
    const fitted = this.fit(content);
    if (!this.current) return this.request(fitted);
    if (!contains(this.current, content)) return this.request(fitted);
    const tooBig = this.current[2] * this.current[3] > this.shrinkRatio * fitted[2] * fitted[3];
    if (!tooBig) {
      this.loose = null;
      return null;
    }
    if (this.loose === null) this.loose = now;
    if (now - this.loose < this.shrinkAfterMs) return null;
    return this.request(fitted);
  }

  request(rect) {
    this.pending = true;
    this.loose = null;
    return rect;
  }

  // The main process moved the window: this is the viewport she's drawn in from now on.
  applied(rect) {
    this.current = rect;
    this.pending = false;
  }
}
