// Hexa herself: where she is, what she's doing, and how she gets from one thing to the next.
// The Brain tells her what Claude is up to (setMode, comeToPointer, celebrate...), app.js feeds her
// the pointer and the screen, and she decides the rest: drifting around, looking at your pointer,
// zapping it, peeking from the edges, falling asleep and folding down into her core.
// Every sequence runs on her own clock (now + update), so it can be tested without timers.

import { solvePose, hitRects as rigHitRects, apply } from './character/rig.js';
import { drawCharacter, drawCore, makeChains, anchorFor } from './character/draw.js';
import { restSpot, clampInto, peekSpots, fallStep, nextDriftTarget, flightStep } from './motion.js';
import { rand as between } from './util.js';

const QUIET_SLEEP = 10 * 60 * 1000;   // nothing for this long: she falls asleep
const SUSPEND_AFTER = 60 * 1000;      // asleep this long: she folds down to her core
const NEAR_LOOK = 160;                // pointer this close: she looks at it
const NEAR_WAKE = 120;                // ... wakes her
const NEAR_SHY = 200;                 // ... sends her ducking when she peeks
const ZAP_LINGER = 3000;              // pointer lingering this long might get zapped
const ZAP_ODDS = 1 / 6;
const ZAP_COOLDOWN = 20000;
const FLOAT_RATE = 4.5;               // how fast she floats to a spot (per second, exponential)
const ALERT_OFFSET = 70;              // how far beside your pointer she waits when Claude needs you
const TELEPORT_FAR = 400;             // further than this, she teleports instead of floating
const TRIP_MS = [260, 900];           // her trip as an orb between vanishing and arriving: shortest, longest
const TRIP_MS_PER_PX = 0.45;
const TELEPORT_WATCHDOG_MS = 2500;    // a teleport takes about 1 s; past this, she's put where she was going
const SEAT_DY = 66;                   // from her hips down to her root, seated (thighs folded)
const LURK_SHOW = 0.36;               // of her height, over a window's top edge when she lurks behind it
const FORK_N = 7;                     // her Fork: copies of her, one in the middle and six round it
const FORK_SCALE = 0.42;              // their size, of hers
const FORK_MARCH_MS = 1400;           // out to their spots (each a little after the one before)
const FORK_STAGGER_MS = 80;
const FORK_CHEER_MS = 1600;
const FORK_REAP_EVERY_MS = 420;       // wait(): one back into her this often
const FORK_REAP_MS = 300;
const WANDER = [45000, 90000];
const POSSESS_EVERY = [60000, 180000]; // sitting idle on a window, now and then she takes it over

const BOOT_LOG = [
  '[ OK ] Mounted /dev/visor',
  '[ OK ] Reached target hair.physics',
  '[ OK ] Started link-led.service',
  '[ OK ] Started hexa.service',
];

const BUSY = new Set(['drag', 'fall', 'teleport', 'boot', 'background', 'thrown']);
// acts that must play to their end (their onEnd moves her on): nothing is played over them
const MUST_FINISH = new Set(['exit0', 'land', 'segfault', 'teleportOut', 'teleportIn', 'suspend', 'resume', 'bootWave', 'sprawl']);
// thrown: released faster than this (px/s) she flies; three throws this close together and she's mad
const THROW_V = 900;
const THROW_MAX = 4000;
const MAD_WINDOW = 20000;
const MAD_LOCK = 15000;

export class Hexa {
  constructor({ rig, player, fx, voice, area, size, scale = 1, rand = Math.random, now = Date.now, settings = {} }) {
    this.rig = rig;
    this.player = player;
    this.fx = fx;
    this.voice = voice;
    this.area = { ...area };
    this.scale = scale;
    this.size = size || { w: 110 * scale, h: 250 * scale };
    this.rand = rand;
    this.now = now;
    this.settings = { wander: true, motion: 'auto', reducedMotion: false, ...settings };
    this.palette = rig.palette;

    this.pos = restSpot(this.area, this.size);
    this.dir = 1;
    this.mode = 'idle';
    this.wantMode = null;
    this.modeSince = now();
    this.lastActivity = now();
    this.tasks = [];
    this.chains = makeChains(rig);
    this.alpha = 1;
    this.fade = null;
    this.hidden = false;
    this.folding = false;
    this.target = null;
    this.vy = 0;
    this.drag = null;
    this.upside = false;
    this.pointer = null;
    this.nearSince = null;
    this.zapRolled = false;
    this.lastZap = -Infinity;
    this.nextWander = now() + between(WANDER[0], WANDER[1], rand);
    this.nextPossess = now() + between(POSSESS_EVERY[0], POSSESS_EVERY[1], rand);
    this.link = 0;
    this.emblemState = null;
    this.flashUntil = 0;
    this.errorUntil = 0;
    this.coreAlert = false;
    this.boot0 = null;
    this.layer = null;
    this.onSay = null;
    this.peekSpot = null;
    this.resumeMode = null;
    this.teleportWatchdog = null;
    this.windows = { fg: 0, wins: [] }; // your windows, front first (main process)
    this.forks = [];                    // her Fork's copies while it runs: { pid, x, y, from, to, t, phase }
    this.perch = null;                  // { id, dx, behind }: the window she sits on (or lurks behind)
    this.pointing = null;               // { rect, aim, side, label, wire } while she points at something
    this.celebrating = null;            // resolves a victory in progress
    this.flight = null;                 // while she's thrown: flightStep state
    this.throws = [];                   // when you last threw her
    this.grabLockUntil = 0;             // mad: no picking her up until then
    this.madPending = false;
    this.onBackground = null;           // (inBackground) => void: tells the main process (config, tray)
    player.stance('stand');
    this.solve(0);
  }

  // ---- little helpers ----

  get reduced() {
    return this.settings.motion === 'reduced' || (this.settings.motion === 'auto' && this.settings.reducedMotion);
  }

  get floor() {
    return this.area.y + this.area.h;
  }

  // Claude is waiting on you and she's on it: chasing your pointer, on her way to it, or eyes
  // open in the background. A mode asked for meanwhile (the prompt was answered) wins.
  get alerting() {
    if (this.mode === 'background') return this.coreAlert;
    if (this.wantMode) return this.wantMode === 'alert';
    if (this.mode === 'teleport') return this.resumeMode === 'alert';
    return this.mode === 'alert';
  }

  later(ms, fn) {
    this.tasks.push({ at: this.now() + ms, fn });
  }

  runTasks() {
    const now = this.now();
    const due = this.tasks.filter((t) => t.at <= now);
    if (!due.length) return;
    this.tasks = this.tasks.filter((t) => t.at > now);
    for (const t of due) t.fn();
  }

  say(key) {
    this.onSay?.(key);
  }

  activity() {
    this.lastActivity = this.now();
  }

  enterMode(mode) {
    this.mode = mode;
    this.modeSince = this.now();
    // perched on a window she stays seated while idle or working; anything else gets her up
    if (mode !== 'idle' && mode !== 'work') this.perch = null;
    const stance = this.perch ? (this.perch.behind ? 'lurk' : 'sit') : { idle: this.music ? 'vibe' : 'stand', work: 'work', alert: 'alert', sleep: 'sleep', fall: 'fall', drag: 'dragged', peek: 'peek', point: 'stand' }[mode];
    if (mode !== 'point' && this.pointing) this.releasePointing();
    if (stance) this.player.stance(stance);
    if (mode !== 'peek') this.upside = false;
  }

  // the mode she goes back to after a move, unless something asked for another one meanwhile
  settleMode(fallback = 'idle') {
    const next = this.wantMode || fallback;
    this.wantMode = null;
    this.enterMode(next);
  }

  point(bone, x, y) {
    const t = this.xf?.get(bone);
    if (!t) return { x: this.pos.x, y: this.pos.y - this.size.h / 2 };
    const [px, py] = apply(t.m, x, y);
    return { x: px, y: py };
  }

  head() {
    return this.point('head', 0, -34);
  }

  body() {
    return { x: this.pos.x, y: this.pos.y - this.size.h * 0.45 };
  }

  coreSpot() {
    if (this.mode === 'background') return { x: this.area.x + 48 * this.scale, y: this.floor - 48 * this.scale };
    return { x: this.pos.x, y: this.pos.y - this.size.h * 0.3 };
  }

  coreRect() {
    const c = this.coreSpot();
    const r = 32 * this.scale;
    return [c.x - r, c.y - r, 2 * r, 2 * r];
  }

  setFade(to, ms) {
    this.fade = { from: this.alpha, to, t0: this.now(), ms };
  }

  // ---- what the Brain asks of her ----

  setMode(mode) {
    if (this.mode === 'background') {
      this.coreAlert = mode === 'alert';
      this.wantMode = mode;
      return;
    }
    if (this.mode === 'sleep' || this.mode === 'suspend') this.wakeUp();
    if (BUSY.has(this.mode)) {
      this.wantMode = mode;
      return;
    }
    if (this.mode === 'peek' && mode !== 'idle') {
      this.wantMode = mode;
      this.teleport(restSpot(this.area, this.size));
      return;
    }
    if (this.mode !== mode) this.enterMode(mode);
  }

  wake() {
    this.activity();
    if (this.mode === 'sleep' || this.mode === 'suspend') this.wakeUp();
  }

  attend() {
    this.activity();
    this.link = 1;
    if (this.mode === 'sleep' || this.mode === 'suspend') this.wakeUp();
  }

  wakeUp() {
    const was = this.mode;
    this.folding = false;
    this.enterMode('idle');
    if (was === 'suspend') this.player.play('resume');
    this.activity();
    this.say('wake');
  }

  perform(act, opts = {}) {
    if (BUSY.has(this.mode) || this.mode === 'sleep' || this.mode === 'suspend') return;
    if (MUST_FINISH.has(this.player.playing)) return;
    if (!this.player.acts[act]) return;
    this.player.play(act, { dir: opts.dir ?? this.dir, onCue: (c) => this.cue(c) });
  }

  // Claude started: to work, perched on the window in front if she can sit on it.
  goToWork() {
    this.activity();
    this.setMode('work');
    if (BUSY.has(this.mode) || this.mode === 'alert') return;
    const seat = this.pickSeat({ frontOnly: true });
    if (seat && (this.perch?.id !== seat.win.id || this.perch.behind)) this.sitOn(seat); // from behind it: up onto its edge
  }

  // ---- your windows (rules ported from upstream v0.4.3) ----

  setWindows(snap) {
    this.windows = snap || { fg: 0, wins: [] };
    if (!this.perch || this.drag || BUSY.has(this.mode)) return;
    const win = this.windows.wins.find((w) => w.id === this.perch.id);
    const dx = win ? Math.min(Math.max(this.perch.dx, 50), win.w - 60) : 0;
    const behind = this.perch.behind;
    if (!win || !(behind ? this.canLurk(win) : this.canSit(win)) || this.covered(win, win.x + dx)) {
      // the ledge is gone: closed, minimised, maximised or covered
      this.vy = 0;
      this.enterMode('fall');
      return;
    }
    this.pos = behind ? this.lurkSpot(win, dx) : this.seat(win, dx); // ride along with the window
  }

  // Where her root goes so that her hips rest on the window's top edge.
  seat(win, dx) {
    return { x: win.x + dx, y: win.y + SEAT_DY * this.scale };
  }

  // Where her root goes so that she stands behind the window, her head and shoulders over its top.
  lurkSpot(win, dx) {
    return { x: win.x + dx, y: win.y + this.size.h * (1 - LURK_SHOW) };
  }

  canLurk(win) {
    return !win.max && win.w > 260 && win.y - this.size.h * LURK_SHOW > this.area.y + 8
      && win.y + this.size.h * (1 - LURK_SHOW) <= this.floor;
  }

  // The top edge of the window she lurks behind (nothing of her below it shows), or null.
  lurkEdge() {
    if (!this.perch?.behind) return null;
    const win = this.windows.wins.find((w) => w.id === this.perch.id);
    return win ? win.y : null;
  }

  // Behind the window you're in, peeking over its top edge. False when there's no window she could
  // do it with.
  lurk() {
    if (BUSY.has(this.mode) || this.mode === 'background' || this.alerting) return false;
    const win = this.windows.wins.find((w) => w.id === this.windows.fg);
    if (!win || !this.canLurk(win)) return false;
    const dx = Math.min(Math.max(between(win.w * 0.2, win.w * 0.8, this.rand), 60), win.w - 60);
    if (this.covered(win, win.x + dx)) return false;
    this.teleport(this.lurkSpot(win, dx), () => {
      this.perch = { id: win.id, dx, behind: true };
      this.enterMode('idle');
    });
    return true;
  }

  canSit(win) {
    const roomAbove = this.size.h * 0.75 + 12;
    return !win.max && win.w > 260 && win.y > this.area.y + roomAbove && win.y < this.floor - 80;
  }

  // Is her spot on that ledge hidden under a window that's in front of it?
  covered(win, x) {
    const half = 34 * this.scale;
    for (const o of this.windows.wins) {
      if (o.id === win.id) return false; // reached it: everything after is behind
      if (o.x < x + half && o.x + o.w > x - half && o.y <= win.y && o.y + o.h >= win.y) return true;
    }
    return false;
  }

  // A window she could sit on, the one in front first: { win, dx } or null.
  pickSeat({ frontOnly = false, except = null } = {}) {
    const options = [];
    for (const win of this.windows.wins) {
      if (win.id === except || !this.canSit(win)) continue;
      const dx = Math.min(Math.max(between(win.w * 0.18, win.w * 0.6, this.rand), 60), Math.max(60, win.w - 190));
      if (this.covered(win, win.x + dx)) continue;
      options.push({ win, dx });
    }
    const front = options.find((o) => o.win.id === this.windows.fg);
    if (frontOnly) return front || null;
    return front || options[0] || null;
  }

  sitOn({ win, dx }) {
    this.teleport(this.seat(win, dx), () => {
      this.perch = { id: win.id, dx };
      this.enterMode(this.mode === 'teleport' ? 'idle' : this.mode);
    });
  }

  // A window whose top edge is within tol of hipY under x, that she could sit on.
  ledgeUnder(x, hipY, tol) {
    return this.windows.wins.find((w) => Math.abs(w.y - hipY) <= tol && x >= w.x + 40 && x <= w.x + w.w - 40
      && this.canSit(w) && !this.covered(w, x)) || null;
  }

  perchOn(win, x) {
    this.perch = { id: win.id, dx: x - win.x };
    this.pos = this.seat(win, this.perch.dx);
  }

  towardCenter() {
    return Math.sign(this.area.x + this.area.w / 2 - this.pos.x) || 1;
  }

  alertTarget() {
    const p = this.pointer;
    const side = p.x + ALERT_OFFSET + this.size.w / 2 > this.area.x + this.area.w ? -1 : 1;
    return clampInto(this.area, { x: p.x + side * ALERT_OFFSET, y: p.y + this.size.h * 0.78 }, this.size);
  }

  comeToPointer() {
    this.activity();
    if (this.mode === 'background') {
      this.coreAlert = true;
      return;
    }
    if (this.mode === 'sleep' || this.mode === 'suspend') this.wakeUp();
    if (BUSY.has(this.mode)) {
      this.wantMode = 'alert';
      return;
    }
    this.enterMode('alert');
    this.voice.play('charge');
    if (!this.pointer) return;
    const t = this.alertTarget();
    if (Math.hypot(t.x - this.pos.x, t.y - this.pos.y) > TELEPORT_FAR) this.teleport(t);
    else this.target = t;
  }

  // exit 0: to the middle of the screen, then the whole victory. Resolves once she's back down.
  celebrate() {
    return new Promise((done) => {
      // whatever happens (the background, a cut animation), the caller gets its answer once
      const resolve = () => {
        if (this.celebrating === resolve) this.celebrating = null;
        done();
      };
      this.celebrating?.();
      this.celebrating = resolve;
      if (this.mode === 'background' || this.mode === 'drag' || this.mode === 'fall') return resolve();
      if (this.reduced) {
        this.player.play('hop');
        this.voice.play('done');
        this.flashUntil = this.now() + 1500;
        return resolve();
      }
      const go = () => {
        this.enterMode('idle');
        this.player.play('exit0', {
          onCue: (c) => this.cue(c),
          onEnd: () => {
            this.settleMode('idle');
            resolve();
          },
        });
      };
      const stage = { x: this.area.x + this.area.w / 2, y: this.floor - 60 * this.scale };
      if (Math.hypot(stage.x - this.pos.x, stage.y - this.pos.y) > 300) this.teleport(stage, go);
      else go();
    });
  }

  knockback() {
    this.activity();
    if (BUSY.has(this.mode) || this.mode === 'sleep' || this.mode === 'suspend') return;
    if (MUST_FINISH.has(this.player.playing)) return;
    this.errorUntil = this.now() + 4000;
    this.target = clampInto(this.area, { x: this.pos.x - this.towardCenter() * 30 * this.scale, y: this.pos.y }, this.size);
    this.player.play('segfault', { onCue: (c) => this.cue(c) });
  }

  spark() {
    this.link = 1;
    if (BUSY.has(this.mode) || this.hidden) return;
    const hand = this.point('handR', 0, 10);
    this.fx.sparks(hand.x, hand.y, 6);
    if (this.mode === 'work' && this.rand() < 0.5) this.fx.glyphs(this.head().x, this.head().y - 40 * this.scale);
  }

  cue(c) {
    const head = this.head();
    const body = this.body();
    switch (c) {
      case 'land':
        this.fx.shards(this.pos.x, this.pos.y, 14, { spread: 160 });
        this.voice.play('land');
        break;
      case 'rise':
        if (!this.reduced) this.fx.speedLines(head.x, head.y);
        this.voice.play('rise');
        break;
      case 'burst':
        this.fx.shockwave(body.x, body.y, { color: this.palette.green });
        this.flashUntil = this.now() + 1500;
        break;
      case 'laugh':
        this.voice.play('done');
        break;
      case 'impact':
        this.fx.impact('red', head.x, head.y);
        if (!this.reduced) this.fx.glitch(600, 1);
        break;
      default:
        break;
    }
  }

  // ---- moving around ----

  teleport(to, then) {
    if (this.mode === 'teleport') return;
    const dest = clampInto(this.area, to || nextDriftTarget(this.area, this.size, this.pos, this.rand), this.size);
    this.resumeMode = this.mode === 'peek' || this.mode === 'teleport' ? 'idle' : this.mode;
    this.enterMode('teleport');
    this.target = null;
    let arrived = false;
    const arrive = () => {
      if (arrived) return;
      arrived = true;
      this.teleportWatchdog = null;
      this.pos = { ...dest };
      this.resetChains();
      const resume = this.resumeMode;
      this.resumeMode = null;
      if (then) {
        // whoever asked for the teleport decides what's next (a peek, the victory...)
        this.enterMode(resume);
        then();
      } else {
        this.settleMode(resume);
      }
    };
    // If anything cuts her teleport animation short (another act played over it), she must still
    // arrive instead of staying hidden mid-teleport forever.
    this.teleportWatchdog = {
      until: this.now() + TELEPORT_WATCHDOG_MS,
      finish: () => {
        this.player.stop();
        this.hidden = false;
        this.alpha = 1;
        this.fade = null;
        arrive();
      },
    };
    if (this.reduced) {
      this.setFade(0, 150);
      this.later(150, () => {
        this.pos = { ...dest };
        this.resetChains();
        this.setFade(1, 150);
        this.later(150, () => {
          this.alpha = 1;
          this.fade = null;
          arrive();
        });
      });
      return;
    }
    this.voice.play('teleport-out');
    this.player.play('teleportOut', {
      fast: true,
      onCue: (c) => {
        if (c !== 'shatter') return;
        const b = this.body();
        this.fx.shards(b.x, b.y, 26, { spread: 220 });
        this.fx.slit(this.pos.x, b.y);
      },
      onEnd: () => {
        this.hidden = true;
        // in transit: an orb from where her body was to where it will be, a longer trip for farther
        const from = this.body();
        const to = { x: from.x + dest.x - this.pos.x, y: from.y + dest.y - this.pos.y };
        const trip = Math.min(TRIP_MS[1], Math.max(TRIP_MS[0], 200 + Math.hypot(to.x - from.x, to.y - from.y) * TRIP_MS_PER_PX));
        this.fx.orb(from, to, trip);
        this.later(trip, () => {
          this.pos = { ...dest };
          this.resetChains();
          this.hidden = false;
          this.fx.column(this.pos.x, this.pos.y);
          this.fx.rings(this.pos.x, this.pos.y);
          this.voice.play('teleport-in');
          this.player.play('teleportIn', {
            fast: true,
            onCue: (c) => {
              if (c !== 'assemble') return;
              const b = this.body();
              const pts = Array.from({ length: 18 }, () => ({ x: b.x + between(-160, 160, this.rand), y: b.y + between(-200, 120, this.rand) }));
              this.fx.assemble(pts, b, 220);
            },
            onEnd: arrive,
          });
        });
      },
    });
  }

  // Music is playing (MPRIS): idle, she nods along.
  setMusic(on) {
    this.music = Boolean(on);
    if (this.mode === 'idle' && !this.player.playing) this.enterMode('idle');
  }

  // Claude needs you but she's not to come (Do Not Disturb): her emblem turns magenta, that's all.
  markWaiting(on) {
    this.emblemState = on ? 'waiting' : null;
  }

  // ---- her Fork ----

  // fork() seven small copies of her, a PID tag each; they march out into a hex lattice in front of
  // her and cheer, then she wait()s and reaps them back into her one by one. Resolves true when
  // it's over, false when she can't now.
  fork() {
    if (this.mode === 'background' || BUSY.has(this.mode) || this.forks.length || this.hidden) return Promise.resolve(false);
    this.activity();
    this.say('fork');
    this.voice.play('fork');
    this.perform('spin');
    const s = this.scale;
    const r = 96 * s;
    const centre = clampInto(this.area, { x: this.pos.x + this.towardCenter() * 300 * s, y: this.floor - 150 * s }, { w: 3 * r, h: 2 * r });
    const spots = [{ x: centre.x, y: centre.y }];
    for (let i = 0; i < FORK_N - 1; i++) {
      const a = (i * Math.PI) / 3;
      spots.push({ x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r });
    }
    const pids = new Set();
    while (pids.size < FORK_N) pids.add(1000 + Math.floor(between(0, 30000, this.rand)) + pids.size);
    const from = { x: this.pos.x, y: this.pos.y - this.size.h * 0.2 };
    this.forks = spots.map((to, i) => ({ pid: [...pids][i], x: from.x, y: from.y, from: { ...from }, to, t: -i * FORK_STAGGER_MS, phase: 'march', bob: i }));
    return new Promise((resolve) => {
      this.later(FORK_MARCH_MS + FORK_N * FORK_STAGGER_MS + FORK_CHEER_MS, () => {
        this.forks.forEach((f, i) => this.later((FORK_N - 1 - i) * FORK_REAP_EVERY_MS, () => {
          f.phase = 'reap';
          f.t = 0;
          f.from = { x: f.x, y: f.y };
        }));
      });
      this.forkDone = () => {
        this.forkDone = null;
        this.say('reaped');
        resolve(true);
      };
    });
  }

  forkUpdate(h) {
    const body = this.body();
    for (const f of this.forks) {
      f.t += h * 1000;
      if (f.phase === 'march') {
        const k = Math.min(1, Math.max(0, f.t / FORK_MARCH_MS));
        const e = 1 - (1 - k) * (1 - k);
        f.x = f.from.x + (f.to.x - f.from.x) * e;
        f.y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * k) * 40 * this.scale;
        if (k >= 1) f.phase = 'cheer';
      } else if (f.phase === 'reap') {
        const k = Math.min(1, f.t / FORK_REAP_MS);
        f.x = f.from.x + (body.x - f.from.x) * k * k;
        f.y = f.from.y + (body.y - f.from.y) * k * k;
        if (k >= 1) {
          f.phase = 'gone';
          this.fx.sparks(body.x, body.y, 5);
          this.voice.play('blip');
        }
      }
    }
    const before = this.forks.length;
    this.forks = this.forks.filter((f) => f.phase !== 'gone');
    if (before && !this.forks.length) this.forkDone?.();
  }

  drawForks(ctx, pose, look) {
    const s = this.scale;
    for (const f of this.forks) {
      const bob = f.phase === 'cheer' ? -Math.abs(Math.sin(this.now() / 140 + f.bob)) * 10 * s : 0;
      ctx.save();
      ctx.translate(f.x, f.y + bob);
      ctx.scale(FORK_SCALE, FORK_SCALE);
      ctx.translate(-this.pos.x, -this.pos.y);
      drawCharacter(ctx, this.rig, this.xf, this.chains, pose, { ...look, alpha: 0.85 * this.alpha });
      ctx.restore();
      ctx.save();
      ctx.font = `600 ${Math.round(10 * s)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.palette.cyan;
      ctx.globalAlpha = 0.9 * this.alpha;
      ctx.fillText(`PID ${f.pid}`, f.x, f.y + bob - this.size.h * FORK_SCALE - 6 * s);
      ctx.restore();
    }
  }

  // ---- possessing a window (rules ported from upstream v0.4.3, her own look) ----

  canPossess() {
    if (this.settings.possess === false || this.reduced) return false;
    if (!this.perch || BUSY.has(this.mode) || this.hidden) return false;
    return this.windows.wins.some((w) => w.id === this.perch.id);
  }

  // She plugs into the window she sits on and dives in: it lights up, glitches and looks at you with
  // her eyes (fx.possess), then she comes out of another window, or further along this one.
  // Resolves true once she's out.
  possess() {
    if (!this.canPossess()) return Promise.resolve(false);
    const id = this.perch.id;
    const rect = () => this.windows.wins.find((w) => w.id === id) || null;
    const covers = () => {
      const front = [];
      for (const o of this.windows.wins) {
        if (o.id === id) break;
        front.push(o);
      }
      return front;
    };
    const entry = this.pos.x - rect().x;
    this.enterMode('teleport'); // inside the window: busy, not clickable
    this.resumeMode = 'idle';
    return new Promise((resolve) => {
      const comeOut = () => {
        const here = rect();
        let seat = this.pickSeat({ except: id });
        if (!seat && here && this.canSit(here)) {
          const dx = Math.min(Math.max(here.w - entry + between(-60, 60, this.rand), 60), Math.max(60, here.w - 190));
          if (!this.covered(here, here.x + dx)) seat = { win: here, dx }; // the other end of it
        }
        this.pos = seat ? this.seat(seat.win, seat.dx) : clampInto(this.area, nextDriftTarget(this.area, this.size, this.pos, this.rand), this.size);
        this.resetChains();
        this.hidden = false;
        this.fx.column(this.pos.x, this.pos.y);
        this.voice.play('teleport-in');
        this.player.play('teleportIn', {
          fast: true,
          onEnd: () => {
            this.resumeMode = null;
            if (seat) this.perch = { id: seat.win.id, dx: seat.dx };
            this.enterMode('idle');
            resolve(true);
          },
        });
      };
      this.voice.play('teleport-out');
      this.player.play('teleportOut', {
        fast: true,
        onCue: (c) => {
          if (c !== 'shatter') return;
          const b = this.body();
          this.fx.shards(b.x, b.y, 18, { spread: 160 });
        },
        onEnd: () => {
          this.hidden = true;
          const taken = this.fx.possess(rect, { covers, look: () => this.pointer, glyphs: this.rig.glyphs });
          this.voice.play('bolt');
          this.later(300, () => this.voice.play('possess'));
          this.later(1900, () => {
            taken.leave();
            this.later(260, comeOut);
          });
        },
      });
    });
  }

  // ---- pointing at things (rules ported from upstream v0.4.3) ----

  // Can she point at this window so you'd see it: not maximised, not tiny, its top not covered.
  canPoint(win) {
    return Boolean(win && !win.max && win.w > 120 && win.y > -10 && !this.covered(win, win.x + win.w / 2));
  }

  // Where to stand to point at rect: beside it, on the side with more room, a bit below its middle
  // (on the floor for things low on the screen).
  spotNear(rect) {
    const s = this.scale;
    const half = this.size.w / 2 + 30;
    const reach = 150 * s + 60; // from her to what she points at: room for the arm to shoot out
    const { x: ax, w: aw, y: ay, h: ah } = this.area;
    const roomLeft = rect.x - ax;
    const roomRight = ax + aw - (rect.x + rect.w);
    let x;
    if (Math.max(roomLeft, roomRight) >= half * 2 + 40) x = roomRight >= roomLeft ? rect.x + rect.w + reach : rect.x - reach;
    else x = rect.x + rect.w / 2 < ax + aw / 2 ? ax + aw - half : ax + half; // nowhere beside it: the far side
    x = Math.min(Math.max(x, ax + half), ax + aw - half);
    const cy = Math.min(Math.max(rect.y + rect.h / 2, ay), this.floor);
    const y = cy > ay + ah * 0.6 ? this.floor : Math.min(Math.max(cy + this.size.h * 0.6, ay + this.size.h + 20), this.floor);
    return { x, y };
  }

  // The point on rect she aims at: as close to her shoulder as it gets, a little inside it.
  aimPoint(rect, shoulder) {
    const inset = Math.min(24, rect.w / 3, rect.h / 3);
    return {
      x: Math.min(Math.max(shoulder.x, rect.x + inset), rect.x + rect.w - inset),
      y: Math.min(Math.max(shoulder.y, rect.y + inset), rect.y + rect.h - inset),
    };
  }

  // Go and point at rect, and keep pointing (a wire from her finger, brackets, a tag) until
  // stopPointing().
  pointAt(rect, { label = '' } = {}) {
    if (this.mode === 'background' || BUSY.has(this.mode)) return Promise.resolve(false);
    if (this.mode === 'sleep' || this.mode === 'suspend') this.wakeUp();
    this.stopPointing();
    const spot = this.spotNear(rect);
    const begin = () => {
      const shoulder = this.point('neck', 0, 0);
      const dirToIt = Math.sign(rect.x + rect.w / 2 - this.pos.x) || 1;
      const side = dirToIt * this.dir > 0 ? 'R' : 'L';
      this.pointing = { rect, aim: this.aimPoint(rect, shoulder), side, label, wire: null };
      this.enterMode('point');
      this.player.play('point', {
        dir: dirToIt,
        onCue: (c) => c === 'lock' && this.lockOn(),
        onEnd: () => this.lockOn(), // the act was cut short: lock on anyway
      });
    };
    this.target = null;
    if (Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) > 140) this.teleport(spot, begin);
    else begin();
    return Promise.resolve(true);
  }

  lockOn() {
    const p = this.pointing;
    if (!p || p.wire) return;
    const hand = p.side === 'R' ? 'handR' : 'handL';
    p.wire = this.fx.pointer(() => this.point(hand, 0, 12), () => this.windows.wins.find((w) => w.id === p.rect.id) || p.rect, { label: p.label });
    this.voice.play('bolt');
  }

  releasePointing() {
    const p = this.pointing;
    this.pointing = null;
    p?.wire?.retract();
  }

  // Done showing: the wire reels back into her finger and the arm drops.
  stopPointing() {
    if (!this.pointing) return;
    this.releasePointing();
    if (this.mode === 'point') {
      this.enterMode('idle');
      this.player.play('unpoint');
    }
  }

  peek() {
    const spots = peekSpots(this.area, this.size);
    const others = spots.filter((s) => s.side !== this.peekSpot?.side);
    const spot = others[Math.floor(this.rand() * others.length) % others.length];
    this.teleport({ x: spot.x, y: spot.y }, () => {
      if (this.wantMode) {
        // Claude started something while she was on her way: no peeking now
        this.settleMode('idle');
        return;
      }
      this.peekSpot = spot;
      this.dir = spot.dir;
      this.enterMode('peek');
      this.upside = spot.side === 'top';
      if (this.upside) this.pos = { x: spot.x, y: spot.y };
    });
  }

  resetChains() {
    this.solve(0);
    for (const def of this.rig.chains) this.chains.get(def.id).reset(anchorFor(this.rig, this.xf, def));
  }

  // ---- what you do to her ----

  // inside: the pointer is on her or on her UI (her panel, the HUD...)
  onPointer(p) {
    this.pointer = { x: p.x, y: p.y, inside: Boolean(p.inside) };
  }

  contains(p) {
    return this.hitRects().some(([x, y, w, h]) => p.x >= x && p.y >= y && p.x <= x + w && p.y <= y + h);
  }

  onDragStart(p) {
    if (this.mode === 'background' || this.mode === 'suspend' || this.mode === 'teleport' || this.mode === 'boot') return false;
    if (!this.contains(p)) return false;
    if (this.now() < this.grabLockUntil) return false; // still mad at you
    this.activity();
    this.flight = null; // caught mid-air
    this.drag = { dx: this.pos.x - p.x, dy: this.pos.y - p.y, last: { ...p }, samples: [{ t: this.now(), x: p.x, y: p.y }] };
    this.target = null;
    this.player.stop();
    this.enterMode('drag');
    this.say('dragged');
    return true;
  }

  onDragMove(p) {
    if (!this.drag) return;
    this.drag.vx = p.x - this.drag.last.x;
    this.drag.last = { ...p };
    const now = this.now();
    this.drag.samples.push({ t: now, x: p.x, y: p.y });
    this.drag.samples = this.drag.samples.filter((v) => now - v.t <= 100);
    this.pos = clampInto(this.area, { x: p.x + this.drag.dx, y: p.y + this.drag.dy }, this.size);
  }

  onDragEnd() {
    if (!this.drag) return;
    const samples = this.drag.samples;
    this.drag = null;
    this.activity();
    // let go mid-swing: she flies off with it
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (samples.length > 1 && dt > 0) {
      let vx = (last.x - first.x) / dt;
      let vy = (last.y - first.y) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed > THROW_V) {
        const k = Math.min(1, THROW_MAX / speed);
        vx *= k;
        vy *= k;
        this.throwHer(vx, vy);
        return;
      }
    }
    // let go with her hips on a window's top edge: she sits there
    const ledge = this.ledgeUnder(this.pos.x, this.pos.y - SEAT_DY * this.scale, 24);
    if (ledge) {
      this.perchOn(ledge, this.pos.x);
      this.settleMode('idle');
      this.say('dropped');
      return;
    }
    if (this.pos.y < this.floor - 2) {
      this.vy = 0;
      this.enterMode('fall');
    } else {
      this.settleMode('idle');
      this.say('dropped');
    }
  }

  throwHer(vx, vy) {
    const now = this.now();
    this.flight = { x: this.pos.x, y: this.pos.y, vx, vy, spin: vx * 0.004 };
    this.enterMode('thrown');
    this.player.stance('fall');
    this.throws = this.throws.filter((t) => now - t < MAD_WINDOW);
    this.throws.push(now);
    if (this.throws.length >= 3) {
      this.throws = [];
      this.madPending = true;
    }
  }

  // she's down (or caught): mad if you've been throwing her around
  afterFlight() {
    this.flight = null;
    if (!this.madPending) return;
    this.madPending = false;
    this.grabLockUntil = this.now() + MAD_LOCK;
    this.say('mad');
    this.later(900, () => this.pointer && this.zap(this.pointer));
  }

  flightUpdate(h) {
    const ledges = this.windows.wins.filter((w) => this.canSit(w)).map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w }));
    const r = flightStep(this.flight, h, { area: this.area, size: this.size, ledges, hipDy: SEAT_DY * this.scale });
    this.flight = r.state;
    this.pos = { x: r.state.x, y: r.state.y };
    for (const e of r.events) {
      const b = this.body();
      if (e.type === 'crash') {
        const x = e.side === 'left' ? this.area.x : this.area.x + this.area.w;
        this.fx.crack(x, b.y);
        this.fx.shards(x, b.y, 10, { spread: 140 });
        this.voice.play('land');
      } else if (e.type === 'ledge' && e.caught) {
        const win = this.windows.wins.find((w) => w.id === e.id);
        if (win) this.perchOn(win, this.pos.x);
        this.enterMode('idle');
        this.player.play('land', { onCue: (c) => this.cue(c) });
        this.say('landed');
        this.afterFlight();
      } else if (e.type === 'ledge') {
        this.fx.shards(this.pos.x, this.pos.y - SEAT_DY * this.scale, 8, { spread: 120 }); // and the window shakes
      } else if (e.type === 'floor') {
        this.enterMode('idle');
        if (e.upright) this.player.play('land', { onCue: (c) => this.cue(c) });
        else this.player.play('sprawl');
        this.say('landed');
        this.afterFlight();
      }
    }
  }

  // 'status' when she should say where Claude is at; null when the click did something else
  onClick() {
    if (this.mode === 'background') {
      this.toggleBackground();
      return null;
    }
    if (this.mode === 'sleep' || this.mode === 'suspend') {
      this.wakeUp();
      return null;
    }
    this.activity();
    return 'status';
  }

  // Ctrl+Alt+H, her menu, or a click on her core. setBackground is the idempotent form.
  setBackground(on) {
    if (Boolean(on) !== (this.mode === 'background')) this.toggleBackground();
  }

  toggleBackground() {
    if (this.mode === 'background') {
      this.boot0 = null;
      this.coreAlert = false;
      this.pos = restSpot(this.area, this.size);
      this.resetChains();
      const next = this.wantMode && this.wantMode !== 'alert' ? this.wantMode : 'idle';
      this.wantMode = null;
      this.enterMode(next);
      this.player.play('resume');
      this.activity();
      this.say('back');
      this.onBackground?.(false);
      return;
    }
    // nothing in flight may pull her back out: no act, no pending step of a teleport or her boot
    this.player.stop();
    this.teleportWatchdog = null;
    this.resumeMode = null;
    this.wantMode = null;
    this.boot0 = null;
    this.celebrating?.();
    this.drag = null;
    this.target = null;
    this.tasks = [];
    this.hidden = false;
    this.alpha = 1;
    this.fade = null;
    this.coreAlert = false;
    this.enterMode('background');
    this.say('background');
    this.onBackground?.(true);
  }

  setArea(area) {
    this.area = { ...area };
    this.pos = clampInto(this.area, this.pos, this.size);
    if (this.target) this.target = clampInto(this.area, this.target, this.size);
  }

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  setScale(scale) {
    this.scale = scale;
    this.size = { w: 110 * scale, h: 250 * scale };
    this.pos = clampInto(this.area, this.pos, this.size);
  }

  // ---- for the demo: her tricks on cue ----

  // lifted up a good way and let go
  drop() {
    if (BUSY.has(this.mode) || this.mode === 'sleep' || this.mode === 'suspend') return;
    this.target = null;
    this.pos = clampInto(this.area, { x: this.pos.x, y: this.area.y + this.area.h * 0.25 }, this.size);
    this.resetChains();
    this.vy = 0;
    this.enterMode('fall');
  }

  sleepNow() {
    if (BUSY.has(this.mode)) return;
    this.enterMode('sleep');
    this.player.play('yawn');
    this.say('sleepy');
  }

  suspendNow() {
    if (BUSY.has(this.mode)) return;
    this.enterMode('suspend');
    this.folding = true;
    this.player.play('suspend', { onEnd: () => { this.folding = false; } });
  }

  // Her overlay just moved to another screen (she followed you there): she appears near your
  // pointer, or in her corner.
  arrive() {
    if (this.mode === 'background') return;
    this.player.stop();
    this.teleportWatchdog = null;
    this.tasks = [];
    this.hidden = false;
    this.alpha = 1;
    this.fade = null;
    const p = this.pointer;
    const near = p ? { x: p.x + (p.x > this.area.x + this.area.w / 2 ? -160 : 160), y: p.y + this.size.h * 0.6 } : restSpot(this.area, this.size);
    this.pos = clampInto(this.area, near, this.size);
    this.resetChains();
    this.enterMode('idle');
    this.fx.column(this.pos.x, this.pos.y);
    this.voice.play('teleport-in');
    this.player.play('teleportIn', { fast: true, onEnd: () => this.settleMode('idle') });
  }

  // ---- her boot ----

  boot() {
    this.enterMode('boot');
    this.boot0 = this.now();
    if (this.reduced) {
      this.alpha = 0;
      this.setFade(1, 300);
      this.voice.play('boot');
      this.later(300, () => {
        this.boot0 = null;
        this.settleMode('idle');
        this.say('boot');
      });
      return;
    }
    this.hidden = true;
    this.later(600, () => {
      this.voice.play('boot');
      const b = this.body();
      const { x, y, w, h } = this.area;
      const pts = Array.from({ length: 40 }, (_, i) => (i % 2
        ? { x: x + w, y: y + this.rand() * h }
        : { x: x + this.rand() * w, y: y + h }));
      this.fx.assemble(pts, b, 1100);
    });
    this.later(1700, () => {
      this.hidden = false;
      this.alpha = 0;
      this.setFade(1, 350);
    });
    this.later(2400, () => {
      this.player.play('bootWave', {
        onEnd: () => {
          this.boot0 = null;
          this.settleMode('idle');
          this.say('boot');
        },
      });
    });
  }

  // ---- every frame ----

  update(dt) {
    const h = Math.min(0.05, Math.max(0, dt || 0));
    const now = this.now();
    this.runTasks();
    if (this.mode === 'teleport' && this.teleportWatchdog && now >= this.teleportWatchdog.until) this.teleportWatchdog.finish();
    this.player.tick(h * 1000);

    if (this.fade) {
      const k = Math.min(1, (now - this.fade.t0) / this.fade.ms);
      this.alpha = this.fade.from + (this.fade.to - this.fade.from) * k;
      if (k >= 1) this.fade = null;
    }

    if (this.mode === 'thrown' && this.flight) this.flightUpdate(h);
    if (this.forks.length) this.forkUpdate(h);

    if (this.mode === 'fall') {
      const hipBefore = this.pos.y - SEAT_DY * this.scale;
      const s = fallStep({ y: this.pos.y, vy: this.vy }, h, this.floor);
      const hipAfter = s.y - SEAT_DY * this.scale;
      // a window ledge under her on the way down catches her
      const ledge = this.windows.wins.find((w) => w.y >= hipBefore && w.y <= hipAfter && this.pos.x >= w.x + 40
        && this.pos.x <= w.x + w.w - 40 && this.canSit(w) && !this.covered(w, this.pos.x));
      if (ledge) {
        this.vy = 0;
        this.perchOn(ledge, this.pos.x);
        this.enterMode('idle');
        this.player.play('land', { onCue: (c) => this.cue(c) });
        this.say('landed');
        s.landed = false;
      } else {
        this.pos.y = s.y;
        this.vy = s.vy;
      }
      if (s.landed) {
        this.enterMode('idle');
        this.player.play('land', { onCue: (c) => this.cue(c), onEnd: () => this.settleMode(this.mode === 'idle' ? 'idle' : this.mode) });
        this.say('landed');
      }
    }

    // coming to you: following your pointer, except while it's on her or her card (its buttons
    // must stay where you're about to click)
    if (this.mode === 'alert' && this.pointer && !this.pointer.inside) {
      const t = this.alertTarget();
      if (Math.hypot(t.x - this.pos.x, t.y - this.pos.y) > TELEPORT_FAR) this.teleport(t);
      else this.target = t;
    }

    if (this.target && !BUSY.has(this.mode)) {
      const k = 1 - Math.exp(-h * FLOAT_RATE);
      this.pos.x += (this.target.x - this.pos.x) * k;
      this.pos.y += (this.target.y - this.pos.y) * k;
      if (Math.hypot(this.target.x - this.pos.x, this.target.y - this.pos.y) < 0.5) {
        this.pos = { ...this.target };
        this.target = null;
      }
    }

    this.pointerRules(now);

    if (this.mode === 'idle' && now - this.lastActivity >= QUIET_SLEEP && !this.player.playing) {
      this.enterMode('sleep');
      this.player.play('yawn');
      this.say('sleepy');
    } else if (this.mode === 'sleep' && now - this.modeSince >= SUSPEND_AFTER) {
      this.enterMode('suspend');
      this.folding = true;
      this.player.play('suspend', { onEnd: () => { this.folding = false; } });
    }

    if (this.settings.wander && this.mode === 'idle' && now >= this.nextWander && !this.player.playing && !this.forks.length) {
      this.nextWander = now + between(WANDER[0], WANDER[1], this.rand);
      if (this.rand() < 0.25) this.peek();
      else if (this.rand() < 0.3 && this.lurk()) { /* behind your window for a while */ }
      else {
        const t = nextDriftTarget(this.area, this.size, this.pos, this.rand);
        if (this.rand() < 1 / 3) this.teleport(t);
        else this.target = t;
      }
    }

    if (this.mode === 'idle' && this.perch && now >= this.nextPossess && !this.player.playing && !this.forks.length) {
      this.nextPossess = now + between(POSSESS_EVERY[0], POSSESS_EVERY[1], this.rand);
      if (this.rand() < 0.5) this.possess();
    }

    if (this.mode === 'work' && this.rand() < h * 0.8) {
      const hd = this.head();
      this.fx.glyphs(hd.x, hd.y - 40 * this.scale, 1);
    }

    this.link = Math.max(0, this.link - h * 2.5);
    this.solve(h);
  }

  pointerRules(now) {
    const p = this.pointer;
    if (!p) return;
    if (this.mode === 'suspend' || this.mode === 'sleep') {
      const c = this.mode === 'suspend' ? this.coreSpot() : this.head();
      if (Math.hypot(p.x - c.x, p.y - c.y) < NEAR_WAKE * this.scale) this.wakeUp();
      return;
    }
    if (this.mode === 'peek') {
      const hd = this.head();
      if (Math.hypot(p.x - hd.x, p.y - hd.y) < NEAR_SHY * this.scale) {
        if (this.rand() < 0.5) this.say('peekShy');
        if (this.rand() < 0.5) this.peek();
        else this.teleport(restSpot(this.area, this.size));
      }
      return;
    }
    if (this.mode !== 'idle' && this.mode !== 'work') return;
    const hd = this.head();
    const near = Math.hypot(p.x - hd.x, p.y - hd.y) < NEAR_LOOK * this.scale;
    if (!near) {
      this.nearSince = null;
      this.zapRolled = false;
      return;
    }
    this.activity();
    if (this.nearSince === null) this.nearSince = now;
    this.dir = Math.sign(p.x - this.pos.x) || this.dir;
    if (this.mode === 'idle' && !this.zapRolled && now - this.nearSince >= ZAP_LINGER && now - this.lastZap >= ZAP_COOLDOWN && !this.player.playing) {
      this.zapRolled = true;
      if (this.rand() < ZAP_ODDS) this.zap(p);
    }
  }

  zap(p) {
    // mid-teleport, asleep or held: not now (playing over a teleport would cut it short)
    if (BUSY.has(this.mode) || this.mode === 'sleep' || this.mode === 'suspend') return;
    this.lastZap = this.now();
    const dir = Math.sign(p.x - this.pos.x) || 1;
    this.player.play('zap', {
      dir,
      onCue: (c) => {
        if (c !== 'bolt') return;
        const hand = this.point(dir > 0 ? 'handR' : 'handL', 0, 12);
        this.fx.bolt(hand, p);
        this.fx.sparks(p.x, p.y, 10);
        this.voice.play('bolt');
      },
    });
    this.say('zap');
  }

  // the pose for this frame, her bones, and her hair and cable following them
  solve(h) {
    const pose = this.player.frame();
    if (this.upside) pose.tilt = (pose.tilt || 0) + 180;
    if (this.pointer && (this.mode === 'idle' || this.mode === 'work') && this.nearSince !== null) {
      const hd = this.xf ? this.head() : this.pos;
      pose.head += Math.max(-0.3, Math.min(0.3, (this.pointer.x - hd.x) / 600));
    }
    // pointing: the arm toward her aim point, drawn longer to reach it
    const p = this.pointing;
    if (p && this.mode === 'point' && this.xf) {
      const sh = this.point(p.side === 'R' ? 'upperR' : 'upperL', 0, 0);
      const rect = this.windows.wins.find((w) => w.id === p.rect.id) || p.rect;
      p.aim = this.aimPoint(rect, sh);
      const dx = Math.abs(p.aim.x - sh.x);
      const dy = p.aim.y - sh.y;
      pose[`arm${p.side}`] = Math.min(2.9, Math.max(0.3, Math.atan2(dx, dy)));
      pose[`elbow${p.side}`] = 0;
      pose[`long${p.side}`] = Math.min(2, Math.max(1, Math.hypot(dx, dy) / ((30 + 28 + 12) * this.scale) * 0.8));
      if (!pose.visor) pose.visor = 'smug';
    }
    this.pose = pose;
    this.xf = solvePose(this.rig, pose, { x: this.pos.x, y: this.pos.y, scale: this.scale, dir: this.dir });
    if (!h) return;
    const wind = (pose.hair || 0) * 60 - (this.drag?.vx || 0) * 40;
    for (const def of this.rig.chains) {
      const lift = def.id === 'cable' ? 0 : (pose.bristle || 0) * 1400;
      this.chains.get(def.id).step(anchorFor(this.rig, this.xf, def), h, wind, lift);
    }
  }

  // ---- what she looks like ----

  look() {
    const p = this.palette;
    const now = this.now();
    let emblem = p.cyan;
    if (this.mode === 'alert' || this.emblemState === 'waiting') emblem = p.magenta;
    else if (this.emblemState === 'thinking') emblem = p.amber;
    if (now < this.errorUntil || this.emblemState === 'error') emblem = p.red;
    if (now < this.flashUntil) emblem = p.green;
    let visor = this.pose?.visor;
    if (!visor) {
      if (this.mode === 'sleep' || this.mode === 'suspend') visor = 'sleepy';
      else if (this.mode === 'alert') visor = 'wide';
      else if (this.emblemState === 'thinking') visor = 'loading';
      else visor = 'calm';
    }
    return { visor, emblem, link: this.link };
  }

  hitRects() {
    if (this.mode === 'background') return [this.coreRect()];
    if (this.mode === 'suspend' && !this.folding) return [this.coreRect()];
    if (this.hidden || this.alpha <= 0.05) return [];
    const rects = rigHitRects(this.rig, this.xf);
    const edge = this.lurkEdge();
    if (edge === null) return rects;
    // behind a window: only what shows over its edge takes your clicks
    return rects.map(([x, y, w, h]) => [x, y, w, Math.min(h, edge - y)]).filter((r) => r[3] > 0);
  }

  draw(ctx) {
    const edge = this.lurkEdge();
    if (edge === null) this.drawSelf(ctx);
    else {
      // behind a window: nothing of her below its top edge
      ctx.save();
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 1e5 + edge);
      ctx.clip();
      this.drawSelf(ctx);
      ctx.restore();
    }
    // her Fork's copies stand on their own, never clipped with her
    if (this.forks.length && !this.hidden) this.drawForks(ctx, this.pose, { ...this.look(), boil: this.player.drawing, alpha: this.alpha });
  }

  drawSelf(ctx) {
    const p = this.palette;
    if (this.mode === 'background' || (this.mode === 'suspend' && !this.folding)) {
      const c = this.coreSpot();
      const alert = this.mode === 'background' && this.coreAlert;
      drawCore(ctx, c.x, c.y, 56 * this.scale, {
        visor: this.rig.glyphs[alert ? 'wide' : 'sleepy'],
        emblem: alert ? p.magenta : p.cyan,
        palette: p,
        lit: alert ? 1 : 0.55 + 0.45 * this.link,
      });
      return;
    }
    if (this.boot0 !== null) this.drawBootLog(ctx);
    if (this.hidden || this.alpha <= 0) return;
    const look = { ...this.look(), boil: this.player.drawing, alpha: this.alpha };
    const pose = this.pose;
    // her forks: two faint copies pulled away from her
    const [ex, ey] = pose.echo || [0, 0];
    if (ex || ey) {
      for (const [k, tint] of [[1, p.magenta], [-1, p.cyan]]) {
        ctx.save();
        ctx.translate(ex * k * this.scale, ey * k * this.scale);
        drawCharacter(ctx, this.rig, this.xf, this.chains, pose, { ...look, alpha: 0.3 * this.alpha, emblem: tint });
        ctx.restore();
      }
    }
    const [sx, sy] = pose.smear || [0, 0];
    if (sx || sy) {
      for (const k of [0.66, 0.33]) {
        ctx.save();
        ctx.translate(-sx * k * this.scale, -sy * k * this.scale);
        drawCharacter(ctx, this.rig, this.xf, this.chains, pose, { ...look, alpha: 0.22 * this.alpha });
        ctx.restore();
      }
    }
    const tint = this.fx.impactKind();
    if (tint || this.fx.glitching()) this.drawLayered(ctx, pose, look, tint);
    else drawCharacter(ctx, this.rig, this.xf, this.chains, pose, look);
  }

  // Through a layer of her own: an impact frame (her silhouette flat white, ink or red) and the
  // glitch only touch her, never what's behind her.
  drawLayered(ctx, pose, look, tint) {
    const rects = rigHitRects(this.rig, this.xf, 60, 1);
    const [bx, by, bw, bh] = rects[0] || [0, 0, 1, 1];
    const w = Math.max(1, Math.ceil(bw));
    const h = Math.max(1, Math.ceil(bh));
    if (!this.layer || this.layer.width < w || this.layer.height < h) this.layer = this.fx.canvas(w, h);
    const lc = this.layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, this.layer.width, this.layer.height);
    lc.translate(-bx, -by);
    drawCharacter(lc, this.rig, this.xf, this.chains, pose, look);
    if (tint) {
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-atop';
      lc.fillStyle = tint === 'red' ? this.palette.red : tint === 'ink' ? this.palette.navy2 : this.palette.white;
      lc.fillRect(0, 0, this.layer.width, this.layer.height);
      lc.globalCompositeOperation = 'source-over';
    }
    this.fx.post(ctx, this.layer, Math.floor(bx), Math.floor(by));
  }

  drawBootLog(ctx) {
    const t = this.now() - this.boot0;
    const x = this.area.x + 24;
    let y = this.floor - 24 - BOOT_LOG.length * 18;
    ctx.save();
    ctx.font = '13px "JetBrains Mono", monospace';
    BOOT_LOG.forEach((line, i) => {
      const start = 200 + i * 550;
      const shown = Math.max(0, Math.min(line.length, Math.floor((t - start) / 14)));
      if (shown <= 0) return;
      ctx.fillStyle = this.palette.green;
      ctx.fillText(line.slice(0, Math.min(6, shown)), x, y);
      ctx.fillStyle = this.palette.white;
      if (shown > 6) ctx.fillText(line.slice(6, shown), x + ctx.measureText(line.slice(0, 6)).width, y);
      y += 18;
    });
    ctx.restore();
  }
}
