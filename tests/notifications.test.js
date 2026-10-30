'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier, escapeMarkup } = require('../src/main/platform/linux/notifications');
const { FakeBus, FakeInterface, Variant, flush } = require('./fake-dbus');

const quiet = { warn() {} };

// A notification server on a fake bus that records every Notify call.
function server({ caps = ['actions', 'body', 'body-markup'], hang = false } = {}) {
  const bus = new FakeBus();
  const sent = [];
  let next = 41;
  const iface = new FakeInterface({
    async GetCapabilities() { return caps; },
    async Notify(app, replaces, icon, summary, body, actions, hints, timeout) {
      if (hang) return new Promise(() => {});
      sent.push({ app, replaces, icon, summary, body, actions, hints, timeout });
      return replaces || ++next;
    },
  });
  bus.serve('org.freedesktop.Notifications', { '/org/freedesktop/Notifications': { 'org.freedesktop.Notifications': iface } });
  return { bus, iface, sent };
}

test('sends as Hexa, with her icon, urgency and desktop entry hints, and returns the id', async () => {
  const { bus, sent } = server();
  const n = createNotifier({ bus, icon: '/opt/hexa/hexa-128.png', Variant, log: quiet });
  const id = await n.notify({ title: 'Claude is done', body: 'penguin-api', urgency: 'critical' });
  assert.equal(id, 42);
  assert.equal(sent.length, 1);
  const [m] = sent;
  assert.equal(m.app, 'Hexa');
  assert.equal(m.icon, '/opt/hexa/hexa-128.png');
  assert.equal(m.summary, 'Claude is done');
  assert.equal(m.body, 'penguin-api');
  assert.deepEqual(m.actions, []);
  assert.equal(m.timeout, -1);
  assert.ok(m.hints.urgency instanceof Variant);
  assert.equal(m.hints.urgency.signature, 'y');
  assert.equal(m.hints.urgency.value, 2);
  assert.equal(m.hints['desktop-entry'].value, 'hexa');
});

test('an unknown urgency is normal', async () => {
  const { bus, sent } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  await n.notify({ title: 't', urgency: 'whatever' });
  assert.equal(sent[0].hints.urgency.value, 1);
});

test('buttons become the action list, and a click on the bubble counts as the default one', async () => {
  const { bus, iface, sent } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  const clicks = [];
  n.onAction((id, action) => clicks.push([id, action]));
  const id = await n.notify({ title: 'Claude needs you', actions: [{ id: 'show', label: 'Show' }], defaultAction: 'show' });
  assert.deepEqual(sent[0].actions, ['show', 'Show', 'default', 'Show']);

  iface.emit('ActionInvoked', id, 'show');
  iface.emit('ActionInvoked', id, 'default');
  assert.deepEqual(clicks, [[id, 'show'], [id, 'show']]);
});

test('actions on other apps’ notifications, or ones we never offered, are ignored', async () => {
  const { bus, iface } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  const clicks = [];
  n.onAction((id, action) => clicks.push([id, action]));
  const id = await n.notify({ title: 't', actions: [{ id: 'show', label: 'Show' }] });
  iface.emit('ActionInvoked', 999, 'show');     // someone else's
  iface.emit('ActionInvoked', id, 'allow');     // not ours to offer
  iface.emit('ActionInvoked', id, 'default');   // no default action on this one
  assert.deepEqual(clicks, []);
});

test('after it closes, a late action does nothing; onClosed hears about it', async () => {
  const { bus, iface } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  const clicks = [];
  const closed = [];
  n.onAction((id, a) => clicks.push(a));
  n.onClosed((id, reason) => closed.push([id, reason]));
  const id = await n.notify({ title: 't', actions: [{ id: 'show', label: 'Show' }] });
  iface.emit('NotificationClosed', id, 2);
  iface.emit('ActionInvoked', id, 'show');
  assert.deepEqual(clicks, []);
  assert.deepEqual(closed, [[id, 2]]);
});

test('bad action ids, the reserved "default", and more than three buttons are dropped', async () => {
  const { bus, sent } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  await n.notify({
    title: 't',
    actions: [{ id: 'default', label: 'x' }, { id: 'Bad Id', label: 'x' }, { id: 'a', label: '' }, null,
      { id: 'one', label: '1' }, { id: 'two', label: '2' }, { id: 'three', label: '3' }, { id: 'four', label: '4' }],
  });
  assert.deepEqual(sent[0].actions, ['one', '1', 'two', '2', 'three', '3']);
});

test('bodies are escaped when the server reads markup, left alone when it does not', async () => {
  const a = server();
  await createNotifier({ bus: a.bus, Variant, log: quiet }).notify({ title: '<b>t</b>', body: 'a <img src="x"> & b' });
  assert.equal(a.sent[0].body, 'a &lt;img src="x"&gt; &amp; b');
  assert.equal(a.sent[0].summary, '<b>t</b>'); // summaries are plain text by spec
  const b = server({ caps: ['body'] });
  await createNotifier({ bus: b.bus, Variant, log: quiet }).notify({ title: 't', body: 'a <i>b</i>' });
  assert.equal(b.sent[0].body, 'a <i>b</i>');
});

test('titles and bodies are cleaned and capped; no title, no notification', async () => {
  const { bus, sent } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  assert.equal(await n.notify({ title: '   ' }), null);
  assert.equal(await n.notify({ title: 42 }), null);
  await n.notify({ title: 'x'.repeat(500) + '‮\u0007', body: 'y'.repeat(2000) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].summary, 'x'.repeat(120) + '…');
  assert.equal(sent[0].body.length, 401);
});

test('replaces updates one in place', async () => {
  const { bus, sent } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  const id = await n.notify({ title: 'a' });
  assert.equal(await n.notify({ title: 'b', replaces: id }), id);
  assert.equal(sent[1].replaces, id);
  await n.notify({ title: 'c', replaces: -3 });
  assert.equal(sent[2].replaces, 0);
});

test('the server is looked up on first use, not before', async () => {
  const { bus } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  await flush();
  assert.equal(bus.proxies, 0);
  await n.notify({ title: 'a' });
  await n.notify({ title: 'b' });
  assert.equal(bus.proxies, 1);
});

test('no notification server: null, and it tries again next time', async () => {
  const bus = new FakeBus();
  const n = createNotifier({ bus, Variant, log: quiet });
  assert.equal(await n.notify({ title: 'a' }), null);
  const iface = new FakeInterface({ async GetCapabilities() { return []; }, async Notify() { return 7; } });
  bus.serve('org.freedesktop.Notifications', { '/org/freedesktop/Notifications': { 'org.freedesktop.Notifications': iface } });
  assert.equal(await n.notify({ title: 'b' }), 7);
});

test('a server that never answers gives null instead of hanging', async () => {
  const { bus } = server({ hang: true });
  const n = createNotifier({ bus, Variant, log: quiet, callMs: 50 });
  assert.equal(await n.notify({ title: 'a' }), null);
});

test('without a session bus it falls back to notify-send, with no buttons', async () => {
  const calls = [];
  const execFile = (file, args, opts, cb) => { calls.push({ file, args }); cb(null); };
  const n = createNotifier({ bus: null, icon: '/i.png', execFile, log: quiet });
  const id = await n.notify({ title: 'Claude is done', body: 'a < b', actions: [{ id: 'show', label: 'Show' }], urgency: 'low' });
  assert.equal(id, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'notify-send');
  assert.deepEqual(calls[0].args, ['--app-name', 'Hexa', '--urgency', 'low', '--icon', '/i.png', '--', 'Claude is done', 'a &lt; b']);
});

test('notify-send missing: nothing happens, nothing throws', async () => {
  const execFile = (file, args, opts, cb) => cb(Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' }));
  const n = createNotifier({ bus: null, execFile, log: quiet });
  assert.equal(await n.notify({ title: 't' }), null);
});

test('stop drops its signal listeners', async () => {
  const { bus, iface } = server();
  const n = createNotifier({ bus, Variant, log: quiet });
  await n.notify({ title: 't' });
  assert.equal(iface.listenerCount('ActionInvoked'), 1);
  n.stop();
  assert.equal(iface.listenerCount('ActionInvoked'), 0);
  assert.equal(iface.listenerCount('NotificationClosed'), 0);
});

test('escapeMarkup', () => {
  assert.equal(escapeMarkup('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;');
});
