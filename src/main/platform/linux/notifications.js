'use strict';

// Desktop notifications through org.freedesktop.Notifications, with buttons (her "Show"), or
// notify-send when there is no session bus. Nothing sent from here can answer a permission
// prompt: the only actions are ones the caller names, and Hexa only ever names "show" (spec §7.4).

const { execFile: realExecFile } = require('node:child_process');
const { clean } = require('../../text');

const NAME = 'org.freedesktop.Notifications';
const PATH = '/org/freedesktop/Notifications';
const URGENCY = { low: 0, normal: 1, critical: 2 };
const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_ACTIONS = 3;
const ACTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
const CALL_MS = 3000; // a notification server that doesn't answer must not hold anything up

const escapeMarkup = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no answer')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// bus: a dbus-next session bus, or null. Variant is injectable so tests needn't load dbus-next.
function createNotifier({
  bus = null, icon = '', appName = 'Hexa', desktopEntry = 'hexa',
  execFile = realExecFile, Variant = bus ? require('dbus-next').Variant : null, log = console, callMs = CALL_MS,
} = {}) {
  let ready = null;       // the server's interface, on first use: starting Hexa never starts a daemon
  let markup = false;     // the server reads <b>, <a>, <img> in bodies: ours are escaped then
  let iface = null;
  const live = new Map(); // our notifications with buttons: id -> { ids: Set, fallback }
  const actionFns = new Set();
  const closedFns = new Set();

  // The server sends these for every app's notifications; only ours, and only actions we offered, count.
  function onInvoked(id, key) {
    const n = live.get(id);
    if (!n) return;
    const action = key === 'default' ? n.fallback : n.ids.has(key) ? key : null;
    if (!action) return;
    for (const fn of actionFns) fn(id, action);
  }
  function onClosed(id, reason) {
    if (!live.delete(id)) return;
    for (const fn of closedFns) fn(id, reason);
  }

  function server() {
    ready ??= (async () => {
      const obj = await bus.getProxyObject(NAME, PATH);
      const i = obj.getInterface(NAME);
      const caps = await i.GetCapabilities().catch(() => []);
      markup = Array.isArray(caps) && caps.includes('body-markup');
      i.on('ActionInvoked', onInvoked);
      i.on('NotificationClosed', onClosed);
      iface = i;
      return i;
    })().catch((err) => {
      ready = null; // try again next time: the server may just have been restarting
      throw err;
    });
    return ready;
  }

  function notifySend({ title, body, urgency }) {
    const args = ['--app-name', appName, '--urgency', urgency, ...(icon ? ['--icon', icon] : []), '--', title, body];
    try {
      execFile('notify-send', args, { timeout: 5000 }, (err) => {
        if (err) log.warn?.(`[hexa] notify-send: ${err.message}`);
      });
    } catch (err) {
      log.warn?.(`[hexa] notify-send: ${err.message}`);
    }
    return null;
  }

  // Resolves the notification's id, or null when it went through notify-send or could not be sent.
  // actions: [{ id, label }] buttons; defaultAction: the id a click on the bubble itself counts as.
  // replaces: an earlier id to update in place instead of stacking another.
  async function notify({ title, body = '', actions = [], defaultAction = null, urgency = 'normal', replaces = 0, timeout = -1 } = {}) {
    const summary = clean(title, MAX_TITLE);
    if (!summary) return null;
    const text = clean(body, MAX_BODY, { lines: true });
    const level = Object.hasOwn(URGENCY, urgency) ? urgency : 'normal';
    const buttons = (Array.isArray(actions) ? actions : [])
      .filter((a) => a && ACTION_ID.test(a.id) && a.id !== 'default' && clean(a.label, 32))
      .slice(0, MAX_ACTIONS)
      .map((a) => ({ id: a.id, label: clean(a.label, 32) }));
    if (!bus) return notifySend({ title: summary, body: escapeMarkup(text), urgency: level });

    try {
      const i = await withTimeout(server(), callMs);
      const list = buttons.flatMap((a) => [a.id, a.label]);
      const fallback = buttons.find((a) => a.id === defaultAction) || null;
      if (fallback) list.push('default', fallback.label);
      const hints = {
        urgency: new Variant('y', URGENCY[level]),
        'desktop-entry': new Variant('s', desktopEntry),
      };
      const replacesId = Number.isInteger(replaces) && replaces > 0 && replaces <= 0xffffffff ? replaces : 0;
      const expire = Number.isInteger(timeout) && timeout >= -1 ? timeout : -1;
      const id = await withTimeout(i.Notify(appName, replacesId, icon, summary, markup ? escapeMarkup(text) : text, list, hints, expire), callMs);
      if (buttons.length) live.set(id, { ids: new Set(buttons.map((a) => a.id)), fallback: fallback?.id || null });
      else live.delete(id); // it replaced one that had buttons
      return id;
    } catch (err) {
      log.warn?.(`[hexa] notification not sent: ${err.message}`);
      return null;
    }
  }

  return {
    notify,
    // fn(id, actionId) when you click one of our buttons (or the bubble, for its default action)
    onAction(fn) {
      actionFns.add(fn);
      return () => actionFns.delete(fn);
    },
    onClosed(fn) {
      closedFns.add(fn);
      return () => closedFns.delete(fn);
    },
    stop() {
      iface?.removeListener('ActionInvoked', onInvoked);
      iface?.removeListener('NotificationClosed', onClosed);
      actionFns.clear();
      closedFns.clear();
      live.clear();
    },
  };
}

module.exports = { createNotifier, escapeMarkup, URGENCY };
