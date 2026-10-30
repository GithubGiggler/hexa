'use strict';

// Do Not Disturb: the Inhibited property of the notification server (Plasma has it). GNOME's
// server has no such property, and no server at all means nobody asked for quiet: both read as off.
// The server is never started by asking: if nothing owns the name, she waits for it to appear.

const NAME = 'org.freedesktop.Notifications';
const PATH = '/org/freedesktop/Notifications';
const PROPS = 'org.freedesktop.DBus.Properties';

async function startDnd({ bus, log = console }) {
  const daemon = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
  let on = false;
  let props = null;
  let gen = 0; // a newer attach wins over one still waiting for its answers
  const fns = new Set();

  const set = (value) => {
    const next = value === true;
    if (next === on) return;
    on = next;
    for (const fn of fns) fn(on);
  };

  async function read(p) {
    try {
      const v = await p.Get(NAME, 'Inhibited');
      return v?.value === true;
    } catch {
      return false; // no such property (GNOME)
    }
  }

  function onProps(iface, changed, invalidated) {
    if (iface !== NAME) return;
    if (changed && Object.hasOwn(changed, 'Inhibited')) set(changed.Inhibited?.value === true);
    else if (Array.isArray(invalidated) && invalidated.includes('Inhibited')) {
      const mine = gen;
      read(props).then((v) => { if (mine === gen) set(v); });
    }
  }

  function detach() {
    props?.removeListener('PropertiesChanged', onProps);
    props = null;
  }

  // (Re)reads the server: at start, and whenever it's replaced (plasmashell restarting).
  async function attach() {
    const mine = ++gen;
    detach();
    let value = false;
    try {
      if (await daemon.NameHasOwner(NAME)) {
        const p = (await bus.getProxyObject(NAME, PATH)).getInterface(PROPS);
        if (mine !== gen) return;
        props = p;
        p.on('PropertiesChanged', onProps);
        value = await read(p);
      }
    } catch (err) {
      log.warn?.(`[hexa] Do Not Disturb unknown: ${err.message}`);
    }
    if (mine === gen) set(value);
  }

  const onOwner = (name) => {
    if (name === NAME) attach();
  };
  daemon.on('NameOwnerChanged', onOwner);
  await attach();

  return {
    get: () => on,
    // fn(on) when it changes
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    stop() {
      gen += 1;
      daemon.removeListener('NameOwnerChanged', onOwner);
      detach();
      fns.clear();
    },
  };
}

module.exports = { startDnd };
