// Hexa herself: where she is, what she's doing, and how she gets from one thing to the next.
// The Brain tells her what Claude is up to (setMode, comeToPointer, celebrate...), app.js feeds her
// the pointer and the screen, and she decides the rest: drifting around, looking at your pointer,
// zapping it, peeking from the edges, falling asleep and folding down into her core.
// Every sequence runs on her own clock (now + update), so it can be tested without timers.

import { solvePose, hitRects as rigHitRects, apply } from './character/rig.js';
import { drawCharacter, drawCore, makeChains, anchorFor } from './character/draw.js';
import { restSpot, clampInto, peekSpots, fallStep, nextDriftTarget } from './motion.js';
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
const TELEPORT_GAP = 250;             // ms between vanishing and arriving
const WANDER = [45000, 90000];

const BOOT_LOG = [
  '[ OK ] Mounted /dev/visor',
  '[ OK ] Reached target hair.physics',
  '[ OK ] Started link-led.service',
  '[ OK ] Started hexa.service',
];

const BUSY = new Set(['drag', 'fall', 'teleport', 'boot', 'background']);

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
    const stance = { idle: 'stand', work: 'work', alert: 'alert', sleep: 'sleep', fall: 'fall', drag: 'dragged', peek: 'peek' }[mode];
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
    if (!this.player.acts[act]) return;
    this.player.play(act, { dir: opts.dir ?? this.dir, onCue: (c) => this.cue(c) });
  }

  goToWork() {
    this.activity();
    this.setMode('work');
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
    return new Promise((resolve) => {
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
    const arrive = () => {
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
    if (this.reduced) {
      this.setFade(0, 150);
      this.later(150, () => {
        this.pos = { ...dest };
        this.resetChains();
        this.dropFarEffects();
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
        this.later(TELEPORT_GAP, () => {
          this.pos = { ...dest };
          this.resetChains();
          this.dropFarEffects();
          this.hidden = false;
          this.fx.column(this.pos.x, this.pos.y);
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

  // what she left behind where she was would otherwise stretch her window across the screen
  dropFarEffects() {
    const b = this.body();
    this.fx.dropFar(b.x, b.y, 400 * this.scale);
  }

  resetChains() {
    this.solve(0);
    for (const def of this.rig.chains) this.chains.get(def.id).reset(anchorFor(this.rig, this.xf, def));
  }

  // ---- what you do to her ----

  onPointer(p) {
    this.pointer = { x: p.x, y: p.y };
  }

  contains(p) {
    return this.hitRects().some(([x, y, w, h]) => p.x >= x && p.y >= y && p.x <= x + w && p.y <= y + h);
  }

  onDragStart(p) {
    if (this.mode === 'background' || this.mode === 'suspend' || this.mode === 'teleport' || this.mode === 'boot') return false;
    if (!this.contains(p)) return false;
    this.activity();
    this.drag = { dx: this.pos.x - p.x, dy: this.pos.y - p.y, last: { ...p } };
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
    this.pos = clampInto(this.area, { x: p.x + this.drag.dx, y: p.y + this.drag.dy }, this.size);
  }

  onDragEnd() {
    if (!this.drag) return;
    this.drag = null;
    this.activity();
    if (this.pos.y < this.floor - 2) {
      this.vy = 0;
      this.enterMode('fall');
    } else {
      this.settleMode('idle');
      this.say('dropped');
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

  toggleBackground() {
    if (this.mode === 'background') {
      this.coreAlert = false;
      this.pos = restSpot(this.area, this.size);
      this.resetChains();
      const next = this.wantMode && this.wantMode !== 'alert' ? this.wantMode : 'idle';
      this.wantMode = null;
      this.enterMode(next);
      this.player.play('resume');
      this.activity();
      this.say('back');
      return;
    }
    this.drag = null;
    this.target = null;
    this.tasks = [];
    this.hidden = false;
    this.alpha = 1;
    this.fade = null;
    this.coreAlert = false;
    this.enterMode('background');
    this.say('background');
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
      // her shards come in from a ring around her, not from across your screen
      const pts = Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2 + this.rand() * 0.3;
        const r = (180 + this.rand() * 120) * this.scale;
        return { x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r };
      });
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
    this.player.tick(h * 1000);

    if (this.fade) {
      const k = Math.min(1, (now - this.fade.t0) / this.fade.ms);
      this.alpha = this.fade.from + (this.fade.to - this.fade.from) * k;
      if (k >= 1) this.fade = null;
    }

    if (this.mode === 'fall') {
      const s = fallStep({ y: this.pos.y, vy: this.vy }, h, this.floor);
      this.pos.y = s.y;
      this.vy = s.vy;
      if (s.landed) {
        this.enterMode('idle');
        this.player.play('land', { onCue: (c) => this.cue(c), onEnd: () => this.settleMode(this.mode === 'idle' ? 'idle' : this.mode) });
        this.say('landed');
      }
    }

    if (this.mode === 'alert' && this.pointer) {
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

    if (this.settings.wander && this.mode === 'idle' && now >= this.nextWander && !this.player.playing) {
      this.nextWander = now + between(WANDER[0], WANDER[1], this.rand);
      if (this.rand() < 0.25) this.peek();
      else {
        const t = nextDriftTarget(this.area, this.size, this.pos, this.rand);
        if (this.rand() < 1 / 3) this.teleport(t);
        else this.target = t;
      }
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
    return rigHitRects(this.rig, this.xf);
  }

  draw(ctx) {
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
