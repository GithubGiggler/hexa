'use strict';

// The only bridge between the stats window's sandboxed page and the main process: window.stats.
// Numbers in, a save dialog out; nothing else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stats', {
  // range: 'today', 'week' or 'month'
  get: (range) => ipcRenderer.invoke('stats:get', String(range)),
  // format: 'csv' or 'json'; saves the range on screen unless another is given
  export: (format, range) => ipcRenderer.invoke('stats:export', String(format), range === undefined ? undefined : String(range)),
});
