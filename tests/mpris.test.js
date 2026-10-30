'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMpris, readMetadata, shortName } = require('../src/main/platform/linux/mpris');
const { FakeBus, FakeInterface, properties, Variant, flush } = require('./fake-dbus');

const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';
const quiet = { warn() {} };

const meta = (title, artists) => new Variant('a{sv}', {
  'xesam:title': new Variant('s', title),
  ...(artists ? { 'xesam:artist': new Variant('as', artists) } : {}),
  'mpris:length': new Variant('x', 1000n),
});

// A player on the fake bus: its Properties and Player interfaces, and the control calls it got.
function player(bus, name, { status = 'Stopped', title = '', artists, identity, announce = true } = {}) {
  const calls = [];
  const control = new FakeInterface(Object.fromEntries(['PlayPause', 'Next', 'Previous', 'Stop'].map((m) => [m, async () => { calls.push(m); }])));
  const props = properties({
    [PLAYER]: { PlaybackStatus: new Variant('s', status), Metadata: meta(title, artists) },
    [ROOT]: identity ? { Identity: new Variant('s', identity) } : {},
  });
  bus.serve(name, { '/org/mpris/MediaPlayer2': { [PLAYER]: control, 'org.freedesktop.DBus.Properties': props } }, { announce });
  return { props, calls };
}

// a fake clock, so "latest" doesn't depend on how fast the test runs
function clock() {
  let t = 1000;
  return () => (t += 10);
}

test('no players: null', async () => {
  const m = await startMpris({ bus: new FakeBus(), log: quiet });
  assert.equal(m.get(), null);
  m.close();
});

test('players already there at start are listed; the playing one wins', async () => {
  const bus = new FakeBus();
  player(bus, 'org.mpris.MediaPlayer2.vlc', { status: 'Paused', title: 'Old', identity: 'VLC media player', announce: false });
  player(bus, 'org.mpris.MediaPlayer2.spotify', { status: 'Playing', title: 'Song', artists: ['A', 'B'], identity: 'Spotify', announce: false });
  bus.serve('org.example.NotAPlayer', {}, { announce: false });
  const m = await startMpris({ bus, log: quiet, now: clock() });
  assert.deepEqual(m.get(), { playing: true, player: 'Spotify', title: 'Song', artist: 'A, B' });
  m.close();
});

test('nothing playing: the one touched last, as not playing', async () => {
  const bus = new FakeBus();
  const a = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Paused', title: 'A song', announce: false });
  player(bus, 'org.mpris.MediaPlayer2.b', { status: 'Paused', title: 'B song', announce: false });
  const m = await startMpris({ bus, log: quiet, now: clock() });
  a.props.change(PLAYER, { Metadata: meta('A next') });
  assert.deepEqual(m.get(), { playing: false, player: 'a', title: 'A next', artist: '' });
  m.close();
});

test('paused beats stopped; of two playing, the latest to start', async () => {
  const bus = new FakeBus();
  const a = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Stopped', announce: false });
  player(bus, 'org.mpris.MediaPlayer2.b', { status: 'Paused', title: 'B', announce: false });
  const m = await startMpris({ bus, log: quiet, now: clock() });
  assert.equal(m.get().player, 'b');
  a.props.change(PLAYER, { PlaybackStatus: new Variant('s', 'Playing') });
  assert.equal(m.get().player, 'a');
  const c = player(bus, 'org.mpris.MediaPlayer2.c', { status: 'Paused', title: 'C' });
  await flush();
  c.props.change(PLAYER, { PlaybackStatus: new Variant('s', 'Playing') });
  assert.equal(m.get().player, 'c');
  m.close();
});

test('a player appearing and vanishing is followed, and onChange hears each change once', async () => {
  const bus = new FakeBus();
  const m = await startMpris({ bus, log: quiet, now: clock() });
  const seen = [];
  m.onChange((s) => seen.push(s));
  const p = player(bus, 'org.mpris.MediaPlayer2.mpv', { status: 'Playing', title: 'Track 1' });
  await flush();
  p.props.change(PLAYER, { Volume: new Variant('d', 0.5) }); // not something get() shows
  p.props.change(PLAYER, { Metadata: meta('Track 2', ['X']) });
  bus.vanish('org.mpris.MediaPlayer2.mpv');
  assert.deepEqual(seen, [
    { playing: true, player: 'mpv', title: 'Track 1', artist: '' },
    { playing: true, player: 'mpv', title: 'Track 2', artist: 'X' },
    null,
  ]);
  assert.equal(p.props.listenerCount('PropertiesChanged'), 0);
  m.close();
});

test('signals from another interface on the player are ignored', async () => {
  const bus = new FakeBus();
  const p = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Playing', title: 'T', announce: false });
  const m = await startMpris({ bus, log: quiet });
  p.props.emit('PropertiesChanged', ROOT, { PlaybackStatus: new Variant('s', 'Paused') }, []);
  assert.equal(m.get().playing, true);
  m.close();
});

test('invalidated properties are read again', async () => {
  const bus = new FakeBus();
  const p = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Paused', title: 'T', announce: false });
  const m = await startMpris({ bus, log: quiet });
  p.props.store[PLAYER].PlaybackStatus = new Variant('s', 'Playing');
  p.props.emit('PropertiesChanged', PLAYER, {}, ['PlaybackStatus']);
  await flush();
  assert.equal(m.get().playing, true);
  m.close();
});

test('the controls act on the chosen player; false with none', async () => {
  const bus = new FakeBus();
  const m0 = await startMpris({ bus, log: quiet });
  assert.equal(await m0.playPause(), false);
  m0.close();

  const a = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Paused', title: 'A', announce: false });
  const b = player(bus, 'org.mpris.MediaPlayer2.b', { status: 'Playing', title: 'B', announce: false });
  const m = await startMpris({ bus, log: quiet, now: clock() });
  assert.equal(await m.playPause(), true);
  assert.equal(await m.next(), true);
  assert.equal(await m.previous(), true);
  assert.equal(await m.stop(), true);
  assert.deepEqual(b.calls, ['PlayPause', 'Next', 'Previous', 'Stop']);
  assert.deepEqual(a.calls, []);
  m.close();
});

test('a player whose control fails gives false, not a throw', async () => {
  const bus = new FakeBus();
  player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Playing', announce: false });
  const m = await startMpris({ bus, log: quiet });
  bus.objects.get('org.mpris.MediaPlayer2.a /org/mpris/MediaPlayer2')[PLAYER].Next = async () => { throw new Error('nope'); };
  assert.equal(await m.next(), false);
  m.close();
});

test('playerctld, which mirrors the real players, is not counted', async () => {
  const bus = new FakeBus();
  player(bus, 'org.mpris.MediaPlayer2.playerctld', { status: 'Playing', title: 'Same song', announce: false });
  const m = await startMpris({ bus, log: quiet });
  assert.equal(m.get(), null);
  player(bus, 'org.mpris.MediaPlayer2.playerctld', { status: 'Playing', title: 'Same song' });
  await flush();
  assert.equal(m.get(), null);
  m.close();
});

test('a broken player is left out, the rest still work', async () => {
  const bus = new FakeBus();
  bus.names.add('org.mpris.MediaPlayer2.ghost'); // listed, but no object behind it
  player(bus, 'org.mpris.MediaPlayer2.ok', { status: 'Playing', title: 'Fine', announce: false });
  const m = await startMpris({ bus, log: quiet });
  assert.equal(m.get().player, 'ok');
  m.close();
});

test('close drops every listener', async () => {
  const bus = new FakeBus();
  const p = player(bus, 'org.mpris.MediaPlayer2.a', { status: 'Playing', announce: false });
  const m = await startMpris({ bus, log: quiet });
  m.close();
  assert.equal(p.props.listenerCount('PropertiesChanged'), 0);
  assert.equal(bus.daemon.listenerCount('NameOwnerChanged'), 0);
});

test('metadata is read defensively and capped; names are shortened', () => {
  assert.deepEqual(readMetadata(meta('T', ['A', 7, 'B'])), { title: 'T', artist: 'A, B' });
  assert.deepEqual(readMetadata(undefined), { title: '', artist: '' });
  assert.equal(readMetadata(new Variant('a{sv}', { 'xesam:title': new Variant('s', 'x'.repeat(300) + '‮') })).title.length, 121);
  assert.equal(shortName('org.mpris.MediaPlayer2.vlc.instance1234'), 'vlc');
  assert.equal(shortName('org.mpris.MediaPlayer2.firefox.instance_1_23'), 'firefox');
  assert.equal(shortName('org.mpris.MediaPlayer2.spotify'), 'spotify');
});
