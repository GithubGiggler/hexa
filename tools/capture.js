'use strict';

// Renders a page of the app offscreen and saves it as a PNG, for looking at her without
// running the overlay. Pages are served from the repo as hexa://app/<path>.
//
//   npx electron tools/capture.js src/renderer/dev/rig.html captures/rig.png [width height]

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, protocol, net } = require('electron');

const root = path.resolve(__dirname, '..');
const [page, out, w = '1600', h = '1000'] = process.argv.slice(2);
if (!page || !out) {
  console.error('usage: electron tools/capture.js <page.html> <out.png> [width height]');
  process.exit(2);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'hexa', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(async () => {
  protocol.handle('hexa', (req) => {
    const url = new URL(req.url);
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'app' || !file.startsWith(root + path.sep)) return new Response('no', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({
    show: false, width: Number(w), height: Number(h), useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true },
  });
  win.webContents.on('console-message', (e) => {
    const { level, message } = e;
    if (level === 'error' || level === 'warning' || level === 3 || level === 2) console.error('[page]', message);
  });
  await win.loadURL(`hexa://app/${page.replace(/^\.?\//, '')}`);
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if ((await win.webContents.executeJavaScript('document.title')) === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log(`saved ${out} (${image.getSize().width}×${image.getSize().height})`);
  app.quit();
});
