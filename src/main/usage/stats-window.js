'use strict';

// "Hexa: usage": an ordinary, decorated app window you open from her menu, showing her records
// by day, project and model. Its page can only ask for numbers (stats:get) and to save them
// to a file you pick (stats:export); both answer that window and no other.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { statsView, toCsv, toJson, exportName } = require('./report');

const FORMATS = {
  csv: { name: 'CSV', extensions: ['csv'] },
  json: { name: 'JSON', extensions: ['json'] },
};

function createStatsWindow({ history, preload, icon, url = 'hexa://app/src/renderer/stats.html', now = Date.now }) {
  let win = null;
  let shown = 'today'; // the tab on screen: what an export saves

  const fromStats = (e) => Boolean(win && !win.isDestroyed() && e.sender === win.webContents);

  ipcMain.handle('stats:get', (e, range) => {
    if (!fromStats(e)) return null;
    const view = statsView(history, String(range), now());
    if (view) shown = view.range;
    return view;
  });

  ipcMain.handle('stats:export', async (e, format, range) => {
    if (!fromStats(e) || !FORMATS[format]) return { ok: false };
    const view = statsView(history, range === undefined ? shown : String(range), now());
    if (!view) return { ok: false };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export usage',
      defaultPath: path.join(app.getPath('downloads'), exportName(view, format)),
      filters: [FORMATS[format]],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, format === 'csv' ? toCsv(view.days) : toJson(view, now()));
      return { ok: true, file: path.basename(filePath) };
    } catch (err) {
      console.error(`[hexa] could not export usage to ${filePath}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    history.reloadPrices(); // your prices.json may have changed since
    win = new BrowserWindow({
      width: 780,
      height: 680,
      minWidth: 560,
      minHeight: 480,
      title: 'Hexa: usage',
      backgroundColor: '#141a2e',
      show: false,
      icon,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.removeMenu();
    // it shows her pages and nothing else
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
      win = null;
    });
    win.loadURL(url);
    return win;
  }

  return {
    open,
    close: () => win && !win.isDestroyed() && win.destroy(),
  };
}

module.exports = { createStatsWindow };
