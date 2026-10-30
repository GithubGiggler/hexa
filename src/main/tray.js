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
    { label: t.lurk, enabled: Boolean(state.visible), click: () => act.lurk() },
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

// The same menu as plain data for the one she draws herself (a right-click on her): every item
// gets an id, and run(id) does what clicking it would. Disabled items do nothing.
function toModel(template) {
  const clicks = new Map();
  const walk = (list, prefix) => list.map((item, i) => {
    if (item.type === 'separator') return { type: 'separator' };
    const id = `${prefix}${i}`;
    const enabled = item.enabled !== false;
    if (item.submenu) return { id, type: 'submenu', label: item.label, enabled, submenu: walk(item.submenu, `${id}.`) };
    if (enabled && item.click) clicks.set(id, item.click);
    const out = { id, type: item.type === 'checkbox' || item.type === 'radio' ? item.type : 'normal', label: item.label, enabled };
    if (out.type !== 'normal') out.checked = Boolean(item.checked);
    return out;
  });
  const items = walk(template, 'm');
  return {
    items,
    run(id) {
      const click = clicks.get(id);
      if (!click) return false;
      click();
      return true;
    },
  };
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

module.exports = { buildMenu, toModel, createTray, SIZES };
