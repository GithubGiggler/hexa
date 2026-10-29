'use strict';

// Her menu: on the tray icon (a StatusNotifierItem on KDE), and when you right-click her.
// buildMenu is pure: state and labels in, a menu template out, so it can be tested without Electron.

const SIZES = [['small', 0.8], ['medium', 1], ['large', 1.25]];

// state: { visible, scale, muted, wander, possess, follow, displays: [{ id, label, current }], startAtLogin,
//          hooks: { installed, error? }, status? }
// act: callbacks named after what they do
function buildMenu(state, t, act) {
  const sep = { type: 'separator' };
  const hooks = state.hooks || {};
  const hookItems = hooks.error
    ? [{ label: t.hooksBroken.replace('{error}', hooks.error), enabled: false }]
    : hooks.installed
      ? [{ label: t.hooksOn, enabled: false }, { label: t.hooksRemove, click: () => act.removeHooks() }]
      : [{ label: t.hooksOff, click: () => act.installHooks() }];
  return [
    { label: state.status || t.online, enabled: false },
    sep,
    state.visible ? { label: t.hide, click: () => act.toggle() } : { label: t.show, click: () => act.toggle() },
    { label: t.teleport, enabled: Boolean(state.visible), click: () => act.teleport() },
    { label: t.demo, click: () => act.demo() },
    { label: t.help, click: () => act.guide() },
    sep,
    {
      label: t.size,
      submenu: SIZES.map(([key, scale]) => ({
        label: t[key], type: 'radio', checked: Math.abs((state.scale ?? 1) - scale) < 0.01, click: () => act.size(scale),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: Boolean(state.muted), click: () => act.mute(!state.muted) },
        { label: t.soundsDir, click: () => act.soundsDir() },
      ],
    },
    {
      label: t.screen,
      submenu: [
        ...(state.displays || []).map((d) => ({ label: d.label, type: 'radio', checked: Boolean(d.current), click: () => act.screen(d.id) })),
        { type: 'separator' },
        { label: t.follow, type: 'checkbox', checked: state.follow !== false, click: () => act.follow(state.follow === false) },
      ],
    },
    { label: t.wander, type: 'checkbox', checked: Boolean(state.wander), click: () => act.wander(!state.wander) },
    { label: t.possess, type: 'checkbox', checked: state.possess !== false, click: () => act.possess(state.possess === false) },
    { label: t.startup, type: 'checkbox', checked: Boolean(state.startAtLogin), click: () => act.startup(!state.startAtLogin) },
    sep,
    ...hookItems,
    sep,
    { label: t.quit, click: () => act.quit() },
  ];
}

// The tray icon itself. rebuild() after anything in the menu changes.
function createTray({ Tray, Menu, icon, tooltip = 'Hexa', getMenu }) {
  const tray = new Tray(icon);
  tray.setToolTip(tooltip);
  let menu = null;
  const rebuild = () => {
    menu = Menu.buildFromTemplate(getMenu());
    tray.setContextMenu(menu);
    return menu;
  };
  rebuild();
  return { tray, rebuild, popup: (opts) => (menu || rebuild()).popup(opts) };
}

module.exports = { buildMenu, createTray, SIZES };
