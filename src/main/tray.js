'use strict';

// Her menu: on the tray icon (a StatusNotifierItem on KDE), and when you right-click her.
// buildMenu is pure: state and labels in, a menu template out, so it can be tested without Electron.

const SIZES = [['small', 0.8], ['medium', 1], ['large', 1.25]];
// the assistants she can watch, and their names' labels
const ASSISTANTS = [['claude', 'watchClaude'], ['codex', 'watchCodex'], ['agy', 'watchAgy']];

// state: { visible, scale, muted, wander, possess, follow, displays: [{ id, label, current }], startAtLogin,
//          assistant: 'claude' | 'codex' | 'agy', hooks: { installed, error?, warning?, permission? }, status? }
//          (hooks: the watched assistant's)
// act: callbacks named after what they do
function buildMenu(state, t, act) {
  const sep = { type: 'separator' };
  const hooks = state.hooks || {};
  const assistant = ASSISTANTS.some(([id]) => id === state.assistant) ? state.assistant : 'claude';
  const name = t[ASSISTANTS.find(([id]) => id === assistant)[1]];
  const named = (label) => label.replace('{name}', name);
  const hookItems = hooks.error
    ? [{ label: named(t.hooksBroken).replace('{error}', hooks.error), enabled: false }]
    : hooks.installed
      ? [{ label: named(t.hooksOn), enabled: false }, { label: named(t.hooksRemove), click: () => act.removeHooks() }]
      : [{ label: named(t.hooksOff), click: () => act.installHooks() }];
  // something in the assistant's own settings that keeps her hooks from running
  if (hooks.warning && !hooks.error) hookItems.push({ label: hooks.warning, enabled: false });
  const watch = {
    label: t.watch,
    submenu: ASSISTANTS.map(([id, key]) => ({ label: t[key], type: 'radio', checked: id === assistant, click: () => act.watch(id) })),
  };
  // opt-in: her card can answer Claude Code's permission prompts (the hook being there is the
  // setting). Claude Code only: the others' hooks can't answer.
  const permission = assistant === 'claude'
    ? [{ label: t.permissions, type: 'checkbox', checked: Boolean(hooks.permission), enabled: !hooks.error, click: () => act.permissions(!hooks.permission) }]
    : [];
  return [
    { label: state.status || t.online, enabled: false },
    sep,
    state.visible ? { label: t.hide, click: () => act.toggle() } : { label: t.show, click: () => act.toggle() },
    { label: t.talk, enabled: Boolean(state.visible), click: () => act.talk() },
    { label: t.teleport, enabled: Boolean(state.visible), click: () => act.teleport() },
    { label: t.lurk, enabled: Boolean(state.visible), click: () => act.lurk() },
    { label: t.fork, enabled: Boolean(state.visible), click: () => act.fork() },
    { label: t.demo, click: () => act.demo() },
    { label: t.help, click: () => act.guide() },
    { label: t.stats, click: () => act.stats() },
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
    watch,
    ...hookItems,
    ...permission,
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

module.exports = { buildMenu, toModel, createTray, SIZES, ASSISTANTS };
