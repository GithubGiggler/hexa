// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.

// Her sounds, synthesised live with Web Audio: nothing recorded ships with her. A file of your
// own in ~/.local/share/hexa/sounds/ named after a sound (done.ogg, alert.wav...) replaces it.

export const SOUNDS = ['boot', 'hello', 'teleport-out', 'teleport-in', 'done', 'alert', 'error', 'land', 'rise', 'bolt', 'charge', 'blip', 'tick'];

const EXTENSIONS = /\.(mp3|wav|ogg|m4a)$/i;
const BLIP_GAP_MS = 45;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// File names from the custom sounds folder → which of her sounds each replaces (first one wins).
export function pickCustom(files) {
  const out = new Map();
  for (const file of files) {
    if (!EXTENSIONS.test(file)) continue;
    const name = file.replace(EXTENSIONS, '').toLowerCase();
    if (SOUNDS.includes(name) && !out.has(name)) out.set(name, file);
  }
  return out;
}

export class Voice {
  constructor({ audio = () => new AudioContext(), customFiles = [], volume = 0.7, muted = false, now = () => performance.now(), rand = Math.random } = {}) {
    this.audio = audio;
    this.ctx = null;
    this.master = null;
    this.volume = volume;
    this.muted = muted;
    this.now = now;
    this.rand = rand;
    this.customFiles = pickCustom(customFiles);
    this.custom = new Map(); // sound → decoded AudioBuffer
    this.lastBlip = -Infinity;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = this.audio();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // soft clip, so stacked sounds never get harsh
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    this.master.connect(shaper).connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setMuted(b) {
    this.muted = Boolean(b);
  }

  // Loads your own sound files (served as hexa://sounds/<file>). Failures leave the synth one.
  async loadCustom(files, urlFor = (f) => `hexa://sounds/${encodeURIComponent(f)}`) {
    this.customFiles = pickCustom(files);
    const ctx = this.ensure();
    this.custom.clear();
    for (const [name, file] of this.customFiles) {
      try {
        const data = await (await fetch(urlFor(file))).arrayBuffer();
        this.custom.set(name, await ctx.decodeAudioData(data));
      } catch (err) {
        console.warn('[hexa] could not load sound', file, err.message);
      }
    }
  }

  play(name) {
    if (this.muted || !SOUNDS.includes(name)) return;
    if (name === 'blip') {
      const now = this.now();
      if (now - this.lastBlip < BLIP_GAP_MS) return;
      this.lastBlip = now;
    }
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume();
    const custom = this.custom.get(name);
    if (custom) {
      const src = ctx.createBufferSource();
      src.buffer = custom;
      src.connect(this.master);
      src.start();
      return;
    }
    const t = ctx.currentTime;
    this[SYNTH[name]](t);
  }

  // ---- building blocks ----

  env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  osc(type, freq, t, dur, peak, { to, dest = this.master } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noiseBurst(t, dur, peak, from, to, q = 2) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, this.rand() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---- her sounds ----

  // a power-on self test: two beeps, then a dial-up-ish chirp
  boot(t) {
    this.osc('square', 880, t, 0.07, 0.12);
    this.osc('square', 1320, t + 0.1, 0.07, 0.12);
    this.osc('sine', 300, t + 0.22, 0.32, 0.18, { to: 1400 });
    this.noiseBurst(t + 0.22, 0.3, 0.05, 1200, 5000, 3);
  }

  hello(t) {
    this.osc('triangle', midi(76), t, 0.09, 0.2);
    this.osc('triangle', midi(83), t + 0.08, 0.14, 0.2);
  }

  teleportOut(t) {
    this.noiseBurst(t, 0.28, 0.18, 3200, 400, 1.5);
    this.osc('sawtooth', 900, t, 0.26, 0.07, { to: 120 });
  }

  teleportIn(t) {
    this.osc('sawtooth', 150, t, 0.26, 0.07, { to: 1100 });
    this.noiseBurst(t, 0.24, 0.16, 400, 3600, 1.5);
  }

  // exit 0: a quick 8-bit arpeggio
  done(t) {
    [72, 76, 79, 84].forEach((n, i) => this.osc('square', midi(n), t + i * 0.075, 0.12, 0.11));
    this.osc('triangle', midi(84), t + 0.3, 0.4, 0.16);
  }

  // ping ping: Claude needs you
  alert(t) {
    [[84, 0], [79, 0.16], [84, 0.32], [79, 0.48]].forEach(([n, d]) => this.osc('triangle', midi(n), t + d, 0.12, 0.2));
  }

  // a detuned buzz, then a blip falling away
  error(t) {
    this.osc('sawtooth', 110, t, 0.24, 0.12);
    this.osc('sawtooth', 116.5, t, 0.24, 0.12);
    this.osc('square', 660, t + 0.22, 0.18, 0.08, { to: 180 });
  }

  land(t) {
    this.osc('sine', 120, t, 0.16, 0.3, { to: 45 });
    this.noiseBurst(t, 0.12, 0.12, 900, 200, 1);
  }

  rise(t) {
    this.osc('sine', 200, t, 0.45, 0.16, { to: 1600 });
    this.noiseBurst(t + 0.05, 0.4, 0.05, 2000, 8000, 4);
  }

  bolt(t) {
    this.noiseBurst(t, 0.09, 0.16, 7000, 2500, 2);
    this.osc('square', 1800, t, 0.05, 0.06, { to: 600 });
  }

  charge(t) {
    this.osc('sine', 220, t, 0.5, 0.1, { to: 880 });
    this.osc('sine', 225, t, 0.5, 0.06, { to: 890 });
  }

  // one syllable of her talking
  blip(t) {
    this.osc('square', 520 + this.rand() * 360, t, 0.035, 0.045);
  }

  tick(t) {
    this.osc('sine', 2000, t, 0.012, 0.08);
  }
}

const SYNTH = {
  boot: 'boot', hello: 'hello', 'teleport-out': 'teleportOut', 'teleport-in': 'teleportIn', done: 'done', alert: 'alert',
  error: 'error', land: 'land', rise: 'rise', bolt: 'bolt', charge: 'charge', blip: 'blip', tick: 'tick',
};
