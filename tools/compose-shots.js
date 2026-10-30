'use strict';

// Makes the README's screenshots from tools/live/screenshots.js captures: her overlay (transparent)
// over a plain desktop, with the test windows drawn in where they were, cropped to the moment.
//
//   node tools/compose-shots.js <shots dir> <out dir>

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [src, dst] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
fs.mkdirSync(dst, { recursive: true });

// where to crop each one: x, y, w, h in screen pixels
const CROPS = {
  work: [560, 180, 1500, 1000],
  hud: [1250, 0, 1310, 820],
  permission: null, // around her card, below
  menu: null,
  lurk: [560, 260, 1500, 900],
  fork: null,
  mainframe: [1500, 560, 1060, 880],
};

for (const [name, { wins, state }] of Object.entries(manifest)) {
  const shot = path.join(src, `${name}.png`);
  if (!fs.existsSync(shot)) continue;
  // around everything clickable of hers, when no crop is set: her, her panel, her menu
  let crop = CROPS[name];
  if (!crop) {
    const rects = [...state.hitRects, ...(state.menu ? [] : [])];
    const x0 = Math.min(...rects.map((r) => r[0])) - 120;
    const y0 = Math.min(...rects.map((r) => r[1])) - 120;
    const x1 = Math.max(...rects.map((r) => r[0] + r[2])) + 120;
    const y1 = Math.max(...rects.map((r) => r[1] + r[3])) + 60;
    crop = [x0, y0, x1 - x0, y1 - y0];
    // her menu opens from her, up and to the left near the screen's corner; her Fork's copies stand in front of her
    if (name === 'menu') crop = [state.pos.x - 520, state.pos.y - 560, 1040, 1100]; // it opens from her, any way
    if (name === 'fork') crop = [state.pos.x - 1150, 560, 1400, 880]; // down to the floor, where they stand
  }
  let [cx, cy, cw, ch] = crop.map(Math.round);
  cx = Math.max(0, cx); cy = Math.max(0, cy);
  cw = Math.min(2560 - cx, cw); ch = Math.min(1440 - cy, ch);
  const boxes = wins.map((w) => `drawbox=x=${w.x}:y=${w.y}:w=${w.w}:h=${w.h}:color=0x262e44:t=fill,drawbox=x=${w.x}:y=${w.y}:w=${w.w}:h=30:color=0x343e5a:t=fill,drawbox=x=${w.x}:y=${w.y}:w=${w.w}:h=${w.h}:color=0x46527a:t=2`).join(',');
  const filter = `[0]${boxes || 'null'}[bg];[bg][1]overlay=0:0,crop=${cw}:${ch}:${cx}:${cy},scale='min(1200,iw)':-2`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=s=2560x1440:c0=0x111726:c1=0x1c2740:x0=0:y0=0:x1=2560:y1=1440:nb_colors=2', '-i', shot,
    '-filter_complex', filter, '-frames:v', '1', path.join(dst, `${name}.png`)]);
  console.log(name, `${cw}x${ch}`);
}
