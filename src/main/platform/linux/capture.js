'use strict';

// Screenshots for her (computer use, "look at my screen"): one display, scaled to fit the model's
// image limits (1280×800 at most, the size computer use works best at), as PNG. toScreen() maps a
// point in the screenshot back to the X server's root coordinates (physical pixels), for her
// hands. A region (zoom) is cut from a full-resolution capture of the same display.

const FIT = { w: 1280, h: 800 };

// how much to scale a w×h screen to fit box
function fitScale(w, h, box = FIT) {
  return Math.min(1, box.w / w, box.h / h);
}

function createCapture({ desktopCapturer, getDisplay, cursor }) {
  const physical = (d) => ({ x: d.bounds.x * d.scaleFactor, y: d.bounds.y * d.scaleFactor, w: Math.round(d.bounds.width * d.scaleFactor), h: Math.round(d.bounds.height * d.scaleFactor) });
  let k = 1;

  const grab = async (d, w, h) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) throw new Error('no screen to capture');
    return src.thumbnail;
  };

  return {
    async capture({ region } = {}) {
      const d = getDisplay();
      const p = physical(d);
      if (!region) {
        const s = fitScale(p.w, p.h);
        const img = await grab(d, Math.round(p.w * s), Math.round(p.h * s));
        const size = img.getSize();
        k = size.width / p.w; // what it really came out at
        return { data: img.toPNG().toString('base64'), width: size.width, height: size.height };
      }
      // zoom: the region (screenshot coordinates) at full resolution, fitted again
      const full = await grab(d, p.w, p.h);
      const [x0, y0, x1, y1] = region.map((v) => v / k);
      const rect = { x: Math.max(0, Math.round(Math.min(x0, x1))), y: Math.max(0, Math.round(Math.min(y0, y1))) };
      rect.width = Math.max(1, Math.min(p.w - rect.x, Math.round(Math.abs(x1 - x0))));
      rect.height = Math.max(1, Math.min(p.h - rect.y, Math.round(Math.abs(y1 - y0))));
      let img = full.crop(rect);
      const s = fitScale(rect.width, rect.height);
      if (s < 1) img = img.resize({ width: Math.round(rect.width * s), height: Math.round(rect.height * s) });
      const size = img.getSize();
      return { data: img.toPNG().toString('base64'), width: size.width, height: size.height };
    },
    toScreen([x, y]) {
      const p = physical(getDisplay());
      return [Math.round(p.x + x / k), Math.round(p.y + y / k)];
    },
    cursor() {
      const c = cursor();
      const p = physical(getDisplay());
      return [Math.round((c.x * getDisplay().scaleFactor - p.x) * k), Math.round((c.y * getDisplay().scaleFactor - p.y) * k)];
    },
  };
}

module.exports = { createCapture, fitScale, FIT };
