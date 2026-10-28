'use strict';

// Checks, against the running app (npm run dev), that clicks land on Hexa only where she is:
// the middle of each of her hit rects must belong to her window, and points in the transparent
// margin of her window must go to whatever is underneath. Prints PASS, or each failing point.
//
//   node tools/check-input-shape.js

const http = require('node:http');
const paths = require('../src/main/paths');
const { connect } = require('../src/main/platform/linux/x11');

function state() {
  return new Promise((resolve, reject) => {
    http.get({ socketPath: paths.socketPath(), path: '/debug/state' }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve(JSON.parse(text)));
    }).on('error', reject);
  });
}

const insideAny = (rects, x, y) => rects.some(([rx, ry, rw, rh]) => x >= rx - 2 && y >= ry - 2 && x <= rx + rw + 2 && y <= ry + rh + 2);

(async () => {
  const s = await state().catch(() => null);
  if (!s?.ok || !s.xid) {
    console.error('Start Hexa with npm run dev first (the debug routes are needed).');
    process.exit(2);
  }
  const x11 = await connect();
  if (!x11) {
    console.error('No X11 display.');
    process.exit(2);
  }
  const scale = 1; // display.scaleFactor on this machine; physical = DIP
  const toRoot = (x, y) => [Math.round((s.display.x + x) * scale), Math.round((s.display.y + y) * scale)];
  const failures = [];
  const checks = [];

  for (const [x, y, w, h] of s.hitRects) checks.push({ what: 'her (hit rect centre)', x: x + w / 2, y: y + h / 2, expect: true });

  // the transparent margin of her own window: everything in it but her should pass through
  const [vx, vy, vw, vh] = s.viewport;
  const margin = [[vx + 8, vy + 8], [vx + vw - 8, vy + 8], [vx + 8, vy + vh - 8], [vx + vw - 8, vy + vh - 8], [vx + vw / 2, vy + 8]];
  for (const [x, y] of margin) {
    if (x < 0 || y < 0 || x > s.display.width || y > s.display.height) continue; // off-screen slack
    if (insideAny(s.hitRects, x, y)) continue;
    checks.push({ what: 'her window margin', x, y, expect: false });
  }

  for (const c of checks) {
    const [rx, ry] = toRoot(c.x, c.y);
    const who = await x11.whoAt(rx, ry);
    const hers = who === s.xid;
    if (hers !== c.expect) failures.push(`${c.what} at (${Math.round(c.x)}, ${Math.round(c.y)}): ${hers ? 'caught by her' : `went to 0x${who.toString(16)}`}`);
  }
  x11.close();
  if (failures.length) {
    console.log(`FAIL (${failures.length} of ${checks.length})`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(`PASS (${checks.length} points: ${s.hitRects.length} on her, ${checks.length - s.hitRects.length} through her window's margin)`);
})();
