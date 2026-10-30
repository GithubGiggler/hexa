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
  // { dnd: bool, music: { playing, player, title, artist } | null } whenever either changes
  onLinuxState: on('linux:state'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  getArea: () => ipcRenderer.invoke('overlay:area'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setHitRects: (rects) => ipcRenderer.send('hits:set', rects),
  openMenu: () => ipcRenderer.send('menu:open'),
  onMenu: on('menu:show'),
  onMenuKey: on('menu:key'),
  menuPick: (id) => ipcRenderer.send('menu:pick', String(id)),
  menuClosed: () => ipcRenderer.send('menu:closed'),
  brainStatus: () => ipcRenderer.invoke('brain:status'),
  brainModels: (tier) => ipcRenderer.invoke('brain:models', String(tier)),
  brainSet: (patch) => ipcRenderer.invoke('brain:set', patch),
  brainKey: (key) => ipcRenderer.invoke('brain:key', String(key || '')),
  chatSend: (text) => ipcRenderer.send('chat:send', String(text)),
  chatStop: () => ipcRenderer.send('chat:stop'),
  chatReset: () => ipcRenderer.send('chat:reset'),
  onChat: on('chat:event'),
  onBrainAsk: on('brain:ask'),
  onBrainGone: on('brain:gone'),
  brainAnswer: (id, value) => ipcRenderer.send('brain:answer', { id: String(id), value: String(value) }),
  onComputerStart: on('computer:start'),
  onComputerStep: on('computer:step'),
  onComputerEnd: on('computer:end'),
  stopComputer: () => ipcRenderer.send('computer:stop'),
  takeFocus: () => ipcRenderer.invoke('focus:take'),
  giveFocus: () => ipcRenderer.send('focus:give'),
  onPermission: on('permission:ask'),
  onPermissionGone: on('permission:gone'),
  answerPermission: (id, choice) => ipcRenderer.send('permission:answer', { id: String(id), choice: String(choice) }),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  openClaudeFolder: () => ipcRenderer.invoke('guide:claudeFolder'),
  trayPlace: () => ipcRenderer.invoke('guide:tray'),
  // /debug/state (dev only): the main process asks, the renderer answers
  answerState: (fn) => ipcRenderer.on('debug:state', async (_e, id) => {
    ipcRenderer.send('debug:state', { id, state: await fn() });
  }),
});
