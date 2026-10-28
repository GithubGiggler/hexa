'use strict';

// Renders Hexa's icons (her core: a glowing hexagon with her visor across it) to
// assets/icons/. Run with: npm run icons

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];
const out = path.resolve(__dirname, '..', 'assets', 'icons');
const pack = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'packs', 'hexa', 'pack.json'), 'utf8'));

// runs in the page: one PNG data URL per size
function draw(sizes, palette, eyes) {
  const hex = (ctx, cx, cy, r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  return sizes.map((s) => {
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    const small = s <= 24;
    const r = s * (small ? 0.47 : 0.4);
    const cx = s / 2;
    const cy = s / 2;
    hex(ctx, cx, cy, r);
    ctx.fillStyle = palette.navy;
    if (!small) {
      ctx.shadowColor = palette.cyan;
      ctx.shadowBlur = s * 0.08;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.2, s * 0.05);
    ctx.strokeStyle = palette.cyan;
    ctx.stroke();
    // visor band
    const bw = r * 1.5;
    const bh = r * (small ? 0.5 : 0.42);
    ctx.fillStyle = palette.visor;
    ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.strokeStyle = palette.amber;
    ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
    if (small) {
      // at tray size, two solid eyes read better than a dot matrix
      ctx.fillStyle = palette.amber;
      const ew = bw * 0.22;
      ctx.fillRect(cx - bw * 0.32, cy - bh * 0.3, ew, bh * 0.6);
      ctx.fillRect(cx + bw * 0.32 - ew, cy - bh * 0.3, ew, bh * 0.6);
    } else {
      const pitch = (bh * 0.84) / 5;
      eyes.forEach((rows, e) => {
        // each eye centred a little in from the middle of the band, like on her visor
        const ox = cx + (e ? 1 : -1) * bw * 0.22 - pitch * 2.5;
        const oy = cy - (pitch * 5) / 2;
        rows.forEach((row, ry) => {
          for (let x = 0; x < 5; x++) {
            if (row[x] !== '#') continue;
            ctx.fillStyle = palette.amber;
            ctx.shadowColor = palette.amber;
            ctx.shadowBlur = pitch;
            ctx.beginPath();
            ctx.arc(ox + (x + 0.5) * pitch, oy + (ry + 0.5) * pitch, pitch * 0.38, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      });
    }
    return c.toDataURL('image/png');
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>');
  const urls = await win.webContents.executeJavaScript(`(${draw})(${JSON.stringify(SIZES)}, ${JSON.stringify(pack.palette)}, ${JSON.stringify(pack.glyphs.smug)})`);
  fs.mkdirSync(out, { recursive: true });
  const save = (name, url) => fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
  SIZES.forEach((s, i) => save(`hexa-${s}.png`, urls[i]));
  save('tray.png', urls[SIZES.indexOf(22)]);
  const tray2x = await win.webContents.executeJavaScript(`(${draw})([44], ${JSON.stringify(pack.palette)}, ${JSON.stringify(pack.glyphs.smug)})`);
  save('tray@2x.png', tray2x[0]);
  console.log(`icons written to ${out}`);
  app.quit();
});
