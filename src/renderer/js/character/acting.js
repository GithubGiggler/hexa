// Portions ported from capri-desktop v0.4.3 (MIT), see NOTICE.

// Pose-to-pose acting, timed the way cel animation is: an act is an exposure sheet, a list of
// drawings, each held for a number of frames at 12 fps ("on twos"). Nothing is tweened. A move is
// a couple of key drawings, an anticipation the other way, sometimes a smear frame, and holds.
//
// Pose fields (anything left out falls back to the stance underneath, then to NEUTRAL):
//   head     head tilt, radians              bristle  hair lift: + stands up, - settles
//   hair     hair sway, px                   tilt     whole-body lean, degrees, screen
//   bob      vertical offset, px, - is up    sx / sy  squash & stretch (sx < 0 mirrors her)
//   armL / armR      upper arms, radians, + raises them outward
//   elbowL / elbowR  forearms, radians, - folds them in across her
//   longL / longR    forearm drawn longer than it is (1 = as drawn), for reaching
//   kickL / kickR    lower legs swinging outward   fold  thighs toward you, 0..1 (sitting)
//   smear    [x, y] smear trail, px          echo     [x, y] afterimages (her forks), px
//   cable    her cable's swing, radians      visor    a visor glyph name
// Shorthands in sheets: arms (both arms), elbows (both forearms), and in directional acts reach
// and long, which go to the arm on the side the act aims at.
//
// A key can carry a cue as third item: hexa.js fires effects and sounds when it's reached.
// Directional acts are drawn aiming to screen-right; played with dir -1 they're mirrored.

export const SHEET_FPS = 12;

export const NEUTRAL = {
  head: 0, bristle: 0, hair: 0, tilt: 0, bob: 0, sx: 1, sy: 1,
  armL: 0, armR: 0, elbowL: 0, elbowR: 0, longL: 1, longR: 1,
  smear: [0, 0], echo: [0, 0], kickL: 0, kickR: 0, fold: 0, cable: 0, visor: null,
};

export const ACTS = {
  // ---- stances (looping) ----

  // floating: four drawings; the arms lag behind the body, the legs dangle
  stand: {
    loop: true,
    keys: [
      [6, { bob: 0, hair: -2.5, arms: 0.07, kickL: 0.04, kickR: -0.02 }],
      [4, { bob: -2, hair: 0, arms: 0.04 }],
      [6, { bob: -4, hair: 2.5, arms: 0.01, kickL: -0.02, kickR: 0.04 }],
      [4, { bob: -2, hair: 0, arms: 0.04 }],
    ],
  },

  // Claude is working: hands up in front of her, tapping at the air like a keyboard
  work: {
    loop: true,
    keys: [
      [3, { arms: 0.5, elbows: -0.95, head: 0.06, bob: -1, cable: 0.1 }],
      [3, { armL: 0.56, armR: 0.46, elbows: -1.05, head: 0.08, bob: -2 }],
      [3, { armL: 0.46, armR: 0.56, elbows: -0.95, head: 0.06, bob: -1, cable: -0.1 }],
      [3, { arms: 0.5, elbows: -1.05, head: 0.04, bob: 0 }],
    ],
  },

  // perched on a window edge: thighs toward you, lower legs swinging, a pause to look around
  sit: {
    loop: true,
    keys: [
      [5, { fold: 1, kickL: 0.3, kickR: -0.02, hair: -1.5, arms: 0.36 }],
      [2, { fold: 1, kickL: 0.12, kickR: 0.12, arms: 0.36 }],
      [5, { fold: 1, kickL: -0.02, kickR: 0.3, hair: 1.5, arms: 0.36 }],
      [2, { fold: 1, kickL: 0.12, kickR: 0.12, arms: 0.36 }],
      [4, { fold: 1, kickL: 0.32, kickR: 0.32, arms: 0.38, bob: -1 }],
      [4, { fold: 1, kickL: 0.02, kickR: 0.02, arms: 0.36 }],
      [12, { fold: 1, kickL: 0.06, kickR: 0.06, head: -0.12, arms: 0.34, visor: 'smug' }],
    ],
  },

  // leaning in from the edge of the screen toward the middle
  peek: {
    loop: true,
    directional: true,
    keys: [
      [8, { tilt: 18, head: 0.2, reach: 0.4, visor: 'ask' }],
      [4, { tilt: 20, head: 0.28 }],
      [10, { tilt: 18, head: 0.14, visor: 'calm' }],
      [3, { tilt: 16, head: 0.22, bob: -1 }],
    ],
  },

  // asleep: slow breathing, head drooping, hair settled
  sleep: {
    loop: true,
    keys: [
      [12, { head: 0.3, tilt: 5, bob: 4, arms: -0.05, visor: 'sleepy', bristle: -0.3 }],
      [12, { head: 0.34, tilt: 6, bob: 6, arms: -0.08, visor: 'sleepy', bristle: -0.4 }],
    ],
  },

  // Claude needs you: hair bristling, hands up, bouncing on the spot
  alert: {
    loop: true,
    keys: [
      [2, { bristle: 1, arms: 0.55, elbows: -0.4, bob: -4, visor: 'wide' }],
      [2, { bristle: 0.8, arms: 0.48, elbows: -0.55, bob: -1, visor: 'wide' }],
      [2, { bristle: 1, arms: 0.6, elbows: -0.35, bob: -4, visor: 'wide' }],
      [6, { bristle: 0.7, arms: 0.45, elbows: -0.5, bob: 0, visor: 'ask' }],
    ],
  },

  // held up by her hood: arms hanging, legs kicking
  dragged: {
    loop: true,
    keys: [
      [3, { arms: 0.15, kickL: 0.38, kickR: -0.1, bristle: 0.3, visor: 'wide', head: 0.1 }],
      [3, { arms: 0.1, kickL: -0.1, kickR: 0.38, bristle: 0.3, visor: 'wide', head: -0.1 }],
    ],
  },

  // falling: stretched long, arms and hair streaming up
  fall: {
    loop: true,
    keys: [
      [2, { sy: 1.15, sx: 0.9, arms: 2.6, bristle: 1, visor: 'wide', kickL: 0.2, kickR: 0.2 }],
      [2, { sy: 1.18, sx: 0.88, arms: 2.75, bristle: 1, visor: 'wide', kickL: 0.3, kickR: 0.1 }],
    ],
  },

  // ---- moves (one-shot) ----

  curious: {
    keys: [
      [4, { head: 0.25, bob: -1 }],
      [8, { head: 0.3, visor: 'ask' }],
      [4, { head: 0.1 }],
    ],
  },

  look: {
    directional: true,
    keys: [
      [3, { head: -0.15 }],
      [10, { head: 0.35, tilt: 4, visor: 'squint' }],
      [3, { head: 0.1 }],
    ],
  },

  // a full turn: she squashes to a sliver, flips, and her forks trail behind
  spin: {
    keys: [
      [2, { sx: 0.6 }],
      [2, { sx: 0.1, echo: [-14, 0] }],
      [2, { sx: -0.6, echo: [-10, 0] }],
      [2, { sx: -1 }],
      [2, { sx: -0.4, echo: [10, 0] }],
      [2, { sx: 0.2, echo: [6, 0] }],
      [3, { sx: 1.08, bob: -2 }],
      [2, { sx: 1 }],
    ],
  },

  hop: {
    keys: [
      [2, { sy: 0.85, sx: 1.1, bob: 2 }],
      [2, { sy: 1.12, sx: 0.92, bob: -14, arms: 0.6 }],
      [3, { bob: -18, arms: 0.8, visor: 'laugh' }],
      [2, { bob: -6 }],
      [2, { sy: 0.9, sx: 1.08, bob: 1 }],
      [2, {}],
    ],
  },

  wave: {
    keys: [
      [3, { armR: 2.3, elbowR: 0.5, visor: 'laugh' }],
      [3, { armR: 2.4, elbowR: 1.1 }],
      [3, { armR: 2.3, elbowR: 0.4 }],
      [3, { armR: 2.4, elbowR: 1.1 }],
      [4, { armR: 2.2, elbowR: 0.6, visor: 'smug' }],
      [3, { armR: 0.4 }],
    ],
  },

  yawn: {
    keys: [
      [6, { arms: 2.4, elbows: 0.6, sy: 1.06, visor: 'squint', head: -0.1 }],
      [8, { arms: 2.6, elbows: 0.7, sy: 1.08, visor: 'sleepy' }],
      [6, { arms: 0.3, visor: 'sleepy', head: 0.15 }],
    ],
  },

  // zapping the pointer: a pull back, then the arm shoots out and a bolt goes
  zap: {
    directional: true,
    keys: [
      [3, { reach: 0.4, tilt: -6, head: -0.1, visor: 'smug' }],
      [2, { reach: 1.4, long: 1.4, tilt: 4 }],
      [1, { reach: 1.57, long: 1.9, tilt: 6, smear: [18, 0] }, 'bolt'],
      [6, { reach: 1.57, long: 1.8, tilt: 5, visor: 'smug' }],
      [3, { reach: 1.2, long: 1.2 }],
      [2, { reach: 0.5 }],
    ],
  },

  // breaking into hex shards: a squash, then she stretches into a line and is gone
  teleportOut: {
    keys: [
      [2, { sy: 0.8, sx: 1.15, bob: 3, bristle: 0.8 }],
      [2, { sy: 1.3, sx: 0.6, bob: -6 }],
      [2, { sy: 1.6, sx: 0.2, bob: -10 }, 'shatter'],
      [2, { sy: 2.2, sx: 0.04, bob: -14 }],
    ],
  },

  teleportIn: {
    keys: [
      [2, { sy: 2.0, sx: 0.05, bob: -12 }, 'assemble'],
      [2, { sy: 1.4, sx: 0.5, bob: -6 }],
      [2, { sy: 0.85, sx: 1.15, bob: 2 }],
      [3, { sy: 1.04, sx: 0.98 }],
      [2, {}],
    ],
  },

  land: {
    keys: [
      [1, { sy: 0.65, sx: 1.3, bob: 6, arms: 0.9, bristle: 1 }, 'land'],
      [2, { sy: 0.78, sx: 1.18, bob: 4, arms: 0.7 }],
      [3, { sy: 1.06, sx: 0.96, bob: -2 }],
      [2, {}],
    ],
  },

  // exit 0: a wind-up, a stretched launch, arms up, the laugh with her head shaking
  exit0: {
    keys: [
      [4, { sy: 0.85, sx: 1.1, bob: 4, arms: -0.15, bristle: -0.5, visor: 'squint' }],
      [2, { sy: 1.25, sx: 0.85, bob: -10, arms: 2.0, smear: [0, 24] }, 'rise'],
      [3, { sy: 1.08, arms: 2.7, elbows: -0.3, bristle: 1, bob: -14, visor: 'laugh' }, 'burst'],
      [12, { arms: 2.6, elbows: -0.35, bristle: 1, bob: -14, visor: 'laugh', head: 0.08 }, 'laugh'],
      [2, { arms: 2.6, head: -0.08, bob: -13, visor: 'laugh' }],
      [2, { arms: 2.6, head: 0.08, bob: -14, visor: 'laugh' }],
      [2, { arms: 2.6, head: -0.08, bob: -13, visor: 'laugh' }],
      [4, { arms: 1.2, bob: -4, visor: 'smug' }],
      [3, {}],
    ],
  },

  // segfault: knocked back by a red impact frame, then dizzy
  segfault: {
    keys: [
      [1, { tilt: -14, sx: 0.85, visor: 'dead', bristle: 1, smear: [-20, 0] }, 'impact'],
      [2, { tilt: 22, head: -0.4, arms: 0.9, visor: 'dead', bob: -4 }],
      [4, { tilt: 18, head: -0.35, arms: 0.7, visor: 'dead' }],
      [6, { tilt: 10, head: -0.2, arms: 0.3, visor: 'dizzy' }],
      [4, { tilt: 3, visor: 'dizzy' }],
      [3, {}],
    ],
  },

  // folding down into her core
  suspend: {
    keys: [
      [4, { sy: 0.9, bob: 3, visor: 'sleepy' }],
      [3, { sy: 0.6, sx: 0.8, bob: 10, visor: 'sleepy' }],
      [2, { sy: 0.25, sx: 0.5, bob: 20, visor: 'sleepy' }],
      [2, { sy: 0.05, sx: 0.2, bob: 24, visor: 'sleepy' }],
    ],
  },

  resume: {
    keys: [
      [2, { sy: 0.2, sx: 0.4, bob: 20 }],
      [2, { sy: 0.7, sx: 0.85, bob: 8 }],
      [2, { sy: 1.1, sx: 0.95, bob: -3, visor: 'wide' }],
      [3, { visor: 'calm' }],
    ],
  },

  // the end of her boot: visor still loading, then a wave
  bootWave: {
    keys: [
      [4, { armR: 2.2, elbowR: 0.5, visor: 'loading' }],
      [3, { armR: 2.4, elbowR: 1.1, visor: 'calm' }],
      [3, { armR: 2.3, elbowR: 0.4 }],
      [3, { armR: 2.4, elbowR: 1.1, visor: 'laugh' }],
      [4, { armR: 2.2, elbowR: 0.6, visor: 'laugh' }],
      [3, { armR: 0.4 }],
    ],
  },
};

// Which drawing of an act is on screen after f frames: { pose, index, cue } (null once a one-shot
// act is over). Holds add up; loops wrap around.
function sample(act, f) {
  const total = act.total ?? (act.total = act.keys.reduce((n, [hold]) => n + hold, 0));
  if (f >= total) {
    if (!act.loop) return null;
    f %= total;
  }
  for (let i = 0; i < act.keys.length; i++) {
    const [hold, pose, cue] = act.keys[i];
    if (f < hold) return { pose, index: i, cue, first: f === 0 };
    f -= hold;
  }
  return null;
}

// Turn a drawing into plain fields: mirror it toward the act's direction and spell out the
// shorthands (arms, elbows, reach, long).
function resolve(pose, act, dir) {
  const out = { ...pose };
  const lean = act.directional ? (dir < 0 ? -1 : 1) : 1;
  if (lean < 0) {
    if (pose.head !== undefined) out.head = -pose.head;
    if (pose.tilt !== undefined) out.tilt = -pose.tilt;
    if (pose.smear) out.smear = [-pose.smear[0], pose.smear[1]];
    if (pose.echo) out.echo = [-pose.echo[0], pose.echo[1]];
  }
  if (pose.arms !== undefined) { out.armL = pose.arms; out.armR = pose.arms; }
  if (pose.elbows !== undefined) { out.elbowL = pose.elbows; out.elbowR = pose.elbows; }
  if (pose.reach !== undefined) out[lean < 0 ? 'armL' : 'armR'] = pose.reach;
  if (pose.long !== undefined) out[lean < 0 ? 'longL' : 'longR'] = pose.long;
  delete out.arms;
  delete out.elbows;
  delete out.reach;
  delete out.long;
  return out;
}

export class Player {
  constructor({ acts = ACTS } = {}) {
    this.acts = acts;
    this.base = null;   // { name, act, ms }
    this.top = null;    // { name, act, ms, dir, fps, frame, onCue, onEnd }
    this.drawing = 0;
    this.clock = 0;     // ms, drives the drawing index at 12 fps
  }

  stance(name) {
    if (this.base?.name === name) return;
    const act = this.acts[name];
    if (!act) throw new Error(`no act "${name}"`);
    this.base = { name, act, ms: 0 };
  }

  get stanceName() {
    return this.base?.name ?? null;
  }

  play(name, { dir = 1, fast = false, onCue, onEnd } = {}) {
    const act = this.acts[name];
    if (!act) throw new Error(`no act "${name}"`);
    const fps = fast ? 24 : act.fps || SHEET_FPS;
    this.top = { name, act, ms: 0, dir, fps, frame: -1, onCue, onEnd };
    this.advanceTop(0);
  }

  get playing() {
    return this.top?.name ?? null;
  }

  stop() {
    this.top = null;
  }

  // Walks the act frame by frame up to its new time, so no cue is ever skipped by a long tick.
  advanceTop(dtMs) {
    const top = this.top;
    top.ms += dtMs;
    const target = Math.floor(top.ms / (1000 / top.fps));
    const total = top.act.keys.reduce((n, [hold]) => n + hold, 0);
    for (let f = top.frame + 1; f <= Math.min(target, total); f++) {
      top.frame = f;
      const s = sample(top.act, f);
      if (!s) {
        this.top = null;
        top.onEnd?.();
        return;
      }
      if (s.first && s.cue) top.onCue?.(s.cue);
    }
  }

  tick(dtMs) {
    const dt = Math.max(0, dtMs || 0);
    const before = Math.floor(this.clock / (1000 / SHEET_FPS));
    this.clock += dt;
    const after = Math.floor(this.clock / (1000 / SHEET_FPS));
    if (this.base) this.base.ms += dt;
    if (this.top) {
      const fast = this.top.fps > SHEET_FPS;
      this.advanceTop(dt);
      // teleports run on ones: the drawing changes twice as often
      if (fast) this.drawing += Math.max(0, Math.floor((this.clock * 2) / (1000 / SHEET_FPS)) - Math.floor(((this.clock - dt) * 2) / (1000 / SHEET_FPS)));
      else this.drawing += after - before;
    } else {
      this.drawing += after - before;
    }
  }

  frame() {
    const out = { ...NEUTRAL };
    if (this.base) {
      const f = Math.floor(this.base.ms / (1000 / (this.base.act.fps || SHEET_FPS)));
      const s = sample(this.base.act, f);
      if (s) Object.assign(out, resolve(s.pose, this.base.act, 1));
    }
    if (this.top) {
      const s = sample(this.top.act, Math.max(0, this.top.frame));
      if (s) Object.assign(out, resolve(s.pose, this.top.act, this.top.dir));
    }
    return out;
  }
}
