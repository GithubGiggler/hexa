'use strict';

// What's playing, from MPRIS: every org.mpris.MediaPlayer2.* name on the session bus, listed at
// start and followed through NameOwnerChanged. get() answers with the one that's playing (the
// latest to start, when several are), else the one you touched last; the controls act on that one.

const { clean } = require('../../text');

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const ROOT = 'org.mpris.MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS = 'org.freedesktop.DBus.Properties';
const RANK = { Playing: 2, Paused: 1 };
const MAX_TEXT = 120;
const MAX_PLAYERS = 32;
// playerctld mirrors whichever real player was used last: counting it would show every song twice
const PROXIES = new Set(['org.mpris.MediaPlayer2.playerctld']);
const isPlayer = (name) => typeof name === 'string' && name.startsWith(PREFIX) && !PROXIES.has(name);

const value = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

// xesam:title is a string, xesam:artist a list of them.
function readMetadata(meta) {
  const m = value(meta) || {};
  const artist = value(m['xesam:artist']);
  return {
    title: clean(value(m['xesam:title']), MAX_TEXT),
    artist: clean(Array.isArray(artist) ? artist.filter((a) => typeof a === 'string').join(', ') : artist, MAX_TEXT),
  };
}

// org.mpris.MediaPlayer2.vlc.instance1234 -> vlc
const shortName = (name) => name.slice(PREFIX.length).replace(/\.instance[^.]*$/, '');

async function startMpris({ bus, log = console, now = Date.now }) {
  const daemon = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
  const players = new Map(); // bus name -> { name, identity, status, title, artist, at, control, props, onProps }
  const fns = new Set();
  let last = JSON.stringify(null);
  let stopped = false;

  function pick() {
    let best = null;
    for (const p of players.values()) {
      if (!p.ready) continue;
      const rank = RANK[p.status] || 0;
      if (!best || rank > best.rank || (rank === best.rank && p.at > best.p.at)) best = { p, rank };
    }
    return best?.p || null;
  }

  function get() {
    const p = pick();
    return p ? { playing: p.status === 'Playing', player: p.identity || shortName(p.name), title: p.title, artist: p.artist } : null;
  }

  function changed() {
    const json = JSON.stringify(get());
    if (json === last) return;
    last = json;
    for (const fn of fns) fn(JSON.parse(json));
  }

  // PlaybackStatus and Metadata, from GetAll's answer or a PropertiesChanged.
  function apply(p, props) {
    let touched = false;
    if (Object.hasOwn(props, 'PlaybackStatus')) {
      const status = String(value(props.PlaybackStatus) || 'Stopped');
      if (status !== p.status) {
        p.status = status;
        touched = true;
      }
    }
    if (Object.hasOwn(props, 'Metadata')) {
      const m = readMetadata(props.Metadata);
      if (m.title !== p.title || m.artist !== p.artist) {
        Object.assign(p, m);
        touched = true;
      }
    }
    if (touched) p.at = now();
  }

  function drop(name) {
    const p = players.get(name);
    if (!p) return;
    players.delete(name);
    p.props?.removeListener('PropertiesChanged', p.onProps);
  }

  async function add(name) {
    drop(name);
    if (players.size >= MAX_PLAYERS) return;
    const p = { name, identity: '', status: 'Stopped', title: '', artist: '', at: now(), ready: false };
    players.set(name, p);
    try {
      const obj = await bus.getProxyObject(name, PATH);
      if (players.get(name) !== p) return; // gone (or replaced) while we asked
      p.control = obj.getInterface(PLAYER);
      p.props = obj.getInterface(PROPS);
      p.onProps = (iface, props, invalidated) => {
        if (iface !== PLAYER || players.get(name) !== p) return;
        apply(p, props || {});
        if (Array.isArray(invalidated) && invalidated.some((k) => k === 'PlaybackStatus' || k === 'Metadata')) {
          p.props.GetAll(PLAYER).then((all) => { if (players.get(name) === p) { apply(p, all); changed(); } }).catch(() => {});
        }
        changed();
      };
      p.props.on('PropertiesChanged', p.onProps);
      const [all, identity] = await Promise.all([
        p.props.GetAll(PLAYER),
        p.props.Get(ROOT, 'Identity').catch(() => null),
      ]);
      if (players.get(name) !== p) return;
      p.identity = clean(value(identity), 40);
      apply(p, all || {});
      p.at = now();
      p.ready = true;
      changed();
    } catch (err) {
      // a player that doesn't answer properly is left out
      if (players.get(name) === p) drop(name);
      log.warn?.(`[hexa] MPRIS player ${name}: ${err.message}`);
    }
  }

  const onOwner = (name, oldOwner, newOwner) => {
    if (stopped || !isPlayer(name)) return;
    if (newOwner) add(name);
    else {
      drop(name);
      changed();
    }
  };
  daemon.on('NameOwnerChanged', onOwner);

  const names = await daemon.ListNames();
  await Promise.all(names.filter(isPlayer).map(add));

  // The controls act on the player get() describes; false when there's none or it refused.
  const command = (method) => async () => {
    const p = pick();
    if (!p?.control?.[method]) return false;
    try {
      await p.control[method]();
      return true;
    } catch (err) {
      log.warn?.(`[hexa] MPRIS ${method} on ${p.name}: ${err.message}`);
      return false;
    }
  };

  return {
    get,
    // fn(state) whenever get()'s answer changes
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    playPause: command('PlayPause'),
    next: command('Next'),
    previous: command('Previous'),
    stop: command('Stop'), // the player's Stop button; close() ends the watching
    close() {
      stopped = true;
      daemon.removeListener('NameOwnerChanged', onOwner);
      for (const name of [...players.keys()]) drop(name);
      fns.clear();
    },
  };
}

module.exports = { startMpris, readMetadata, shortName };
