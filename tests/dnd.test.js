'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startDnd } = require('../src/main/platform/linux/dnd');
const { sessionBusAddress, openSessionBus } = require('../src/main/platform/linux/session-bus');
const { FakeBus, properties, Variant, flush } = require('./fake-dbus');

const NAME = 'org.freedesktop.Notifications';
const IFACE = 'org.freedesktop.Notifications';
const quiet = { warn() {} };

// A notification server whose properties live in store (Plasma: { Inhibited }; GNOME: none).
function notificationServer(bus, store, opts) {
  const props = properties({ [IFACE]: store });
  bus.serve(NAME, { '/org/freedesktop/Notifications': { 'org.freedesktop.DBus.Properties': props } }, opts);
  return props;
}

test('reads Inhibited at start (Plasma with Do Not Disturb on)', async () => {
  const bus = new FakeBus();
  notificationServer(bus, { Inhibited: new Variant('b', true) }, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  assert.equal(dnd.get(), true);
  dnd.stop();
});

test('follows PropertiesChanged, and tells onChange only when it changes', async () => {
  const bus = new FakeBus();
  const props = notificationServer(bus, { Inhibited: new Variant('b', false) }, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  const seen = [];
  dnd.onChange((on) => seen.push(on));
  props.change(IFACE, { Inhibited: new Variant('b', true) });
  props.change(IFACE, { Inhibited: new Variant('b', true) });
  props.change('some.other.Interface', { Inhibited: new Variant('b', false) });
  props.change(IFACE, { Inhibited: new Variant('b', false) });
  assert.deepEqual(seen, [true, false]);
  dnd.stop();
});

test('an invalidated Inhibited is read again', async () => {
  const bus = new FakeBus();
  const props = notificationServer(bus, { Inhibited: new Variant('b', false) }, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  // the value changes without being sent along: only the invalidation says so
  props.store[IFACE].Inhibited = new Variant('b', true);
  props.emit('PropertiesChanged', IFACE, {}, ['Inhibited']);
  assert.equal(dnd.get(), false);
  await flush();
  assert.equal(dnd.get(), true);
  dnd.stop();
});

test('a server without the property (GNOME) is off', async () => {
  const bus = new FakeBus();
  notificationServer(bus, {}, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  assert.equal(dnd.get(), false);
  dnd.stop();
});

test('no server: off, nothing started, and it picks the server up when one appears', async () => {
  const bus = new FakeBus();
  const dnd = await startDnd({ bus, log: quiet });
  assert.equal(dnd.get(), false);
  assert.equal(bus.proxies, 1); // only the bus daemon itself: asking never activates a server
  const seen = [];
  dnd.onChange((on) => seen.push(on));
  notificationServer(bus, { Inhibited: new Variant('b', true) });
  await flush();
  assert.equal(dnd.get(), true);
  assert.deepEqual(seen, [true]);
  dnd.stop();
});

test('the server going away turns it off; a new one is read afresh and the old one is not listened to', async () => {
  const bus = new FakeBus();
  const old = notificationServer(bus, { Inhibited: new Variant('b', true) }, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  assert.equal(dnd.get(), true);
  bus.vanish(NAME);
  await flush();
  assert.equal(dnd.get(), false);
  assert.equal(old.listenerCount('PropertiesChanged'), 0);
  const fresh = notificationServer(bus, { Inhibited: new Variant('b', false) });
  await flush();
  assert.equal(dnd.get(), false);
  assert.equal(fresh.listenerCount('PropertiesChanged'), 1);
  dnd.stop();
});

test('stop drops every listener', async () => {
  const bus = new FakeBus();
  const props = notificationServer(bus, { Inhibited: new Variant('b', false) }, { announce: false });
  const dnd = await startDnd({ bus, log: quiet });
  dnd.stop();
  assert.equal(props.listenerCount('PropertiesChanged'), 0);
  assert.equal(bus.daemon.listenerCount('NameOwnerChanged'), 0);
});

test('session bus address: the variable, then systemd’s user bus, else none', () => {
  assert.equal(sessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }, () => false), 'unix:path=/x');
  assert.equal(sessionBusAddress({ XDG_RUNTIME_DIR: '/run/user/1000' }, (p) => p === '/run/user/1000/bus'), 'unix:path=/run/user/1000/bus');
  assert.equal(sessionBusAddress({ XDG_RUNTIME_DIR: '/run/user/1000' }, () => false), null);
  assert.equal(sessionBusAddress({ XDG_RUNTIME_DIR: 'relative' }, () => true), null);
  assert.equal(sessionBusAddress({}, () => true), null);
});

test('openSessionBus: null without a bus, and errors on the connection are caught', () => {
  assert.equal(openSessionBus({ env: {}, exists: () => false }), null);
  const { EventEmitter } = require('node:events');
  const fake = new EventEmitter();
  const dbus = { sessionBus: ({ busAddress }) => { fake.address = busAddress; return fake; } };
  const warned = [];
  const bus = openSessionBus({ env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }, dbus, log: { warn: (m) => warned.push(m) } });
  assert.equal(bus, fake);
  assert.equal(fake.address, 'unix:path=/x');
  fake.emit('error', new Error('connection lost')); // would throw without a listener
  assert.equal(warned.length, 1);
  const broken = { sessionBus: () => { throw new Error('bad address'); } };
  assert.equal(openSessionBus({ env: { DBUS_SESSION_BUS_ADDRESS: 'nope' }, dbus: broken, log: quiet }), null);
});
