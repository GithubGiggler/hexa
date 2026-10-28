'use strict';

// The only bridge between Hexa's sandboxed renderer and the main process: window.host.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onEvent: on('hexa:event'),
  onCommand: on('hexa:command'),
  onPointer: on('pointer'),
  onArea: on('overlay:area'),
  onConfig: on('hexa:config'),
  onWindows: on('windows:update'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  getArea: () => ipcRenderer.invoke('overlay:area'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setHitRects: (rects) => ipcRenderer.send('hits:set', rects),
  openMenu: () => ipcRenderer.send('menu:open'),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  // /debug/state (dev only): the main process asks, the renderer answers
  answerState: (fn) => ipcRenderer.on('debug:state', async (_e, id) => {
    ipcRenderer.send('debug:state', { id, state: await fn() });
  }),
});
