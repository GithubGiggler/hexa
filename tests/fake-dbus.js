'use strict';

// A stand-in for a dbus-next session bus, shaped like its proxy API: getProxyObject(name, path)
// gives an object whose getInterface(iface) is an EventEmitter with the D-Bus methods on it. Signals
// are emitted by the tests. Nothing here touches a real bus.

const { EventEmitter } = require('node:events');
const { Variant } = require('dbus-next');

class DBusError extends Error {
  constructor(type, text) {
    super(text || type);
    this.type = type;
  }
}

class FakeInterface extends EventEmitter {
  constructor(methods = {}) {
    super();
    Object.assign(this, methods);
  }
}

// org.freedesktop.DBus.Properties over a { iface: { prop: Variant } } store.
function properties(store) {
  const props = new FakeInterface({
    async Get(iface, prop) {
      const v = store[iface]?.[prop];
      if (v === undefined) throw new DBusError('org.freedesktop.DBus.Error.InvalidArgs', `no property ${prop}`);
      return v;
    },
    async GetAll(iface) {
      return { ...(store[iface] || {}) };
    },
  });
  props.store = store;
  // what a service does when one of its properties changes
  props.change = (iface, changed, invalidated = []) => {
    store[iface] = { ...(store[iface] || {}), ...changed };
    props.emit('PropertiesChanged', iface, changed, invalidated);
  };
  return props;
}

class FakeBus {
  constructor() {
    this.objects = new Map(); // `${name} ${path}` -> { iface: FakeInterface }
    this.names = new Set();
    this.proxies = 0;         // getProxyObject calls, to prove nothing was started early
    this.owner = 1;
    this.daemon = new FakeInterface({
      ListNames: async () => ['org.freedesktop.DBus', ...this.names],
      NameHasOwner: async (name) => this.names.has(name),
    });
    this.objects.set('org.freedesktop.DBus /org/freedesktop/DBus', { 'org.freedesktop.DBus': this.daemon });
  }

  // A service appears on the bus with objects at paths: { path: { iface: FakeInterface } }.
  serve(name, objects, { announce = true } = {}) {
    for (const [p, ifaces] of Object.entries(objects)) this.objects.set(`${name} ${p}`, ifaces);
    this.names.add(name);
    if (announce) this.daemon.emit('NameOwnerChanged', name, '', `:1.${++this.owner}`);
  }

  vanish(name) {
    for (const key of [...this.objects.keys()]) if (key.startsWith(`${name} `)) this.objects.delete(key);
    this.names.delete(name);
    this.daemon.emit('NameOwnerChanged', name, `:1.${this.owner}`, '');
  }

  async getProxyObject(name, path) {
    this.proxies += 1;
    const ifaces = this.objects.get(`${name} ${path}`);
    if (!ifaces) throw new DBusError('org.freedesktop.DBus.Error.ServiceUnknown', `${name} is not on the bus`);
    return {
      name,
      path,
      getInterface(iface) {
        if (!ifaces[iface]) throw new Error(`interface not found in proxy object: ${iface}`);
        return ifaces[iface];
      },
    };
  }
}

// Lets pending promise callbacks run.
const flush = () => new Promise((resolve) => setImmediate(resolve));

module.exports = { FakeBus, FakeInterface, DBusError, properties, Variant, flush };
