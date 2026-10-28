// Effects around her: hexagon shards, shards flying back together, sparks, floating hex digits,
// bolts, speed lines, shockwaves, the slit she leaves when she teleports, a column of light where
// she lands, impact flashes and the glitch on her layer. Everything is time-based and clamped,
// so a frozen frame or a resume from sleep never sends particles to infinity.

const TAU = Math.PI * 2;
const DRAWING = 1 / 12; // effects that are "drawn" (bolts, speed lines) change on twos
const MAX_DT = 0.05;
const HEX = '0123456789ABCDEF';

function hexPath(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * TAU) / 6;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

const easeIn = (t) => t * t * t;

// The parts of rect not covered by any of covers (rects { x, y, w, h }): what of a window you can
// actually see, so possessing it never draws over the windows in front of it.
export function visibleParts(rect, covers) {
  let parts = [{ ...rect }];
  for (const c of covers) {
    const next = [];
    for (const p of parts) {
      const x0 = Math.max(p.x, c.x);
      const y0 = Math.max(p.y, c.y);
      const x1 = Math.min(p.x + p.w, c.x + c.w);
      const y1 = Math.min(p.y + p.h, c.y + c.h);
      if (x1 <= x0 || y1 <= y0) {
        next.push(p);
        continue;
      }
      if (y0 > p.y) next.push({ x: p.x, y: p.y, w: p.w, h: y0 - p.y });                     // above
      if (y1 < p.y + p.h) next.push({ x: p.x, y: y1, w: p.w, h: p.y + p.h - y1 });           // below
      if (x0 > p.x) next.push({ x: p.x, y: y0, w: x0 - p.x, h: y1 - y0 });                   // left
      if (x1 < p.x + p.w) next.push({ x: x1, y: y0, w: p.x + p.w - x1, h: y1 - y0 });        // right
    }
    parts = next;
  }
  return parts.filter((p) => p.w > 0 && p.h > 0);
}

// Her visor eyes as dot matrices, the way glyphs.js draws them (kept here: fx draws in display
// space, with its own glow).
function drawEyes(ctx, eyes, x, y, w, h, color) {
  const half = w / 2;
  const pitch = Math.min(half, h) / 5;
  ctx.fillStyle = color;
  eyes.forEach((rows, eye) => {
    const ox = x + eye * half + (half - pitch * 5) / 2;
    const oy = y + (h - pitch * 5) / 2;
    rows.forEach((row, ry) => {
      for (let cx = 0; cx < 5; cx++) {
        if (row[cx] !== '#') continue;
        ctx.beginPath();
        ctx.arc(ox + (cx + 0.5) * pitch, oy + (ry + 0.5) * pitch, pitch * 0.38, 0, TAU);
        ctx.fill();
      }
    });
  });
}

export class Fx {
  constructor({ palette, rand = Math.random, cap = 600 }) {
    this.palette = palette;
    this.rand = rand;
    this.cap = cap;
    this.particles = [];
    this.effects = [];
    this.impactState = null;
    this.glitchState = null;
    this.glitchSlices = [];
    this.sliceClock = 0;
    this.tinted = null;
  }

  r(a, b) {
    return a + (b - a) * this.rand();
  }

  pickColor(color) {
    if (color) return color;
    const { cyan, white, magenta } = this.palette;
    const roll = this.rand();
    return roll < 0.6 ? cyan : roll < 0.85 ? white : magenta;
  }

  add(p) {
    this.particles.push(p);
    if (this.particles.length > this.cap) this.particles.splice(0, this.particles.length - this.cap);
    return p;
  }

  count() {
    return this.particles.length;
  }

  // ---- particles ----

  shards(x, y, n, { spread = 180, color, gravity = 320 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = this.r(0, TAU);
      const v = spread * this.r(0.35, 1);
      const max = this.r(0.6, 1.4);
      this.add({ kind: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spread * 0.25, g: gravity, size: this.r(2.5, 6.5), rot: this.r(0, TAU), vr: this.r(-6, 6), life: max, max, color: this.pickColor(color) });
    }
  }

  // shards flying in from points and landing on a target (her body coming together)
  assemble(points, target, durMs, { color } = {}) {
    const dur = Math.max(0.05, durMs / 1000);
    for (const from of points) {
      this.add({ kind: 'assemble', x: from.x, y: from.y, from: { ...from }, to: { ...target }, t: 0, dur, swirl: this.r(-1, 1), size: this.r(2.5, 5.5), rot: this.r(0, TAU), vr: this.r(-8, 8), life: dur, max: dur, color: this.pickColor(color) });
    }
  }

  sparks(x, y, n = 8, { color } = {}) {
    for (let i = 0; i < n; i++) {
      const a = this.r(0, TAU);
      const v = this.r(220, 520);
      const max = this.r(0.15, 0.32);
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, life: max, max, color: color || this.palette.cyan });
    }
  }

  // little hex digits shed while Claude works
  glyphs(x, y, n = 2) {
    for (let i = 0; i < n; i++) {
      const max = this.r(0.9, 1.6);
      this.add({ kind: 'glyph', x: x + this.r(-30, 30), y: y + this.r(-10, 10), vx: this.r(-12, 12), vy: this.r(-55, -30), g: 0, life: max, max, text: HEX[Math.floor(this.rand() * 16)] + HEX[Math.floor(this.rand() * 16)], color: this.palette.cyan });
    }
  }

  // ---- drawn effects ----

  jag(from, to, rough) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(4, Math.round(len / 18));
    const nx = -dy / len;
    const ny = dx / len;
    const pts = [{ x: from.x, y: from.y }];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = this.r(-1, 1) * rough * Math.sin(Math.PI * t);
      pts.push({ x: from.x + dx * t + nx * off, y: from.y + dy * t + ny * off });
    }
    pts.push({ x: to.x, y: to.y });
    return pts;
  }

  bolt(from, to, { color, drawings = 3, width = 2.2, rough = 16 } = {}) {
    const e = { kind: 'bolt', from: { ...from }, to: { ...to }, color: color || this.palette.cyan, width, rough, life: drawings * DRAWING, clock: 0 };
    e.points = this.jag(e.from, e.to, rough);
    this.effects.push(e);
    return e;
  }

  speedLines(cx, cy, { n = 26, inner = 90, outer = 600 } = {}) {
    const e = { kind: 'speed', cx, cy, n, inner, outer, life: 0.42, max: 0.42, clock: 0, angles: [] };
    e.angles = Array.from({ length: n }, () => this.r(0, TAU));
    this.effects.push(e);
  }

  shockwave(x, y, { color } = {}) {
    this.effects.push({ kind: 'ring', x, y, life: 0.45, max: 0.45, color: color || this.palette.cyan });
  }

  // where she was, after she teleports: a black slit with a cyan line in it
  slit(x, y) {
    this.effects.push({ kind: 'slit', x, y, life: 0.9, max: 0.9 });
  }

  // where she arrives: a column of light down to her
  column(x, y) {
    this.effects.push({ kind: 'column', x, y, life: 0.5, max: 0.5 });
  }

  // an impact frame: her silhouette goes flat white, ink or red for two drawings (hexa.js), with a
  // flash around her
  impact(kind, x = 0, y = 0) {
    this.impactState = { kind, life: 2 * DRAWING };
    this.effects.push({ kind: 'flash', x, y, tone: kind, life: 2 * DRAWING, max: 2 * DRAWING });
  }

  impactKind() {
    return this.impactState && this.impactState.life > 0 ? this.impactState.kind : null;
  }

  // Possessing a window: its frame lights up, a hex grid sweeps it, slices glitch, and it looks at
  // you with her visor across it, more of her eyes opening all over it, every one on your pointer.
  // rect() and covers() are asked every frame, so it follows the window; nothing is drawn over the
  // windows in front of it, and the window's contents are never read. Returns { leave }.
  possess(rect, { covers = () => [], look = () => null, glyphs } = {}) {
    const e = { kind: 'possess', rect, covers, look, glyphs, t: 0, life: Infinity, max: Infinity, eyes: [], clock: 0, slices: [] };
    for (let i = 0; i < 9; i++) e.eyes.push({ u: this.r(0.08, 0.92), v: this.r(0.12, 0.9), at: 0.25 + i * 0.12, s: this.r(0.6, 1.2) });
    this.effects.push(e);
    return {
      leave: () => {
        if (e.life === Infinity) {
          e.life = 0.3;
          e.max = 0.3;
        }
      },
    };
  }

  drawPossess(ctx, e) {
    const r = e.rect();
    if (!r) return;
    const { cyan, magenta, amber, white, visor } = this.palette;
    const k = e.life === Infinity ? 1 : Math.max(0, e.life / e.max);
    ctx.save();
    ctx.globalAlpha = k;
    // the frame, crackling
    ctx.shadowColor = cyan;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.shadowBlur = 0;
    // everything else only on the parts of the window you can see
    ctx.beginPath();
    for (const p of visibleParts(r, e.covers())) ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(20, 26, 46, 0.35)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // the hex grid sweeping down
    const sweep = r.y + ((e.t * 0.9) % 1) * r.h;
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35 * k;
    const cell = 28;
    for (let gy = r.y; gy < sweep; gy += cell * 0.866) {
      const row = Math.round((gy - r.y) / (cell * 0.866));
      for (let gx = r.x + (row % 2) * cell * 0.75; gx < r.x + r.w; gx += cell * 1.5) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          const px = gx + Math.cos(a) * cell * 0.5;
          const py = gy + Math.sin(a) * cell * 0.5;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.9 * k;
    ctx.fillStyle = white;
    ctx.fillRect(r.x, sweep - 1, r.w, 2);
    // glitched slices
    for (const sl of e.slices) {
      ctx.globalAlpha = 0.28 * k;
      ctx.fillStyle = sl.c ? magenta : cyan;
      ctx.fillRect(r.x + sl.dx, r.y + sl.y * r.h, r.w, sl.h * r.h);
    }
    // her visor, huge, laughing across it
    const vw = Math.min(r.w * 0.7, 560);
    const vh = vw / 3.6;
    const vx = r.x + (r.w - vw) / 2;
    const vy = r.y + r.h * 0.46 - vh / 2;
    ctx.globalAlpha = 0.92 * k;
    ctx.fillStyle = visor;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = amber;
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, vy, vw, vh);
    if (e.glyphs?.laugh) drawEyes(ctx, e.glyphs.laugh, vx + vw * 0.08, vy + vh * 0.12, vw * 0.84, vh * 0.76, amber);
    // more of her eyes opening all over it, every one on your pointer
    const at = e.look();
    for (const eye of e.eyes) {
      if (e.t < eye.at) continue;
      const ex = r.x + eye.u * r.w;
      const ey = r.y + eye.v * r.h;
      const size = 16 * eye.s;
      ctx.globalAlpha = Math.min(1, (e.t - eye.at) * 4) * k;
      ctx.fillStyle = visor;
      ctx.beginPath();
      ctx.ellipse(ex, ey, size * 1.4, size, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = amber;
      ctx.stroke();
      const ang = at ? Math.atan2(at.y - ey, at.x - ex) : 0;
      ctx.fillStyle = amber;
      ctx.shadowColor = amber;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(ex + Math.cos(ang) * size * 0.6, ey + Math.sin(ang) * size * 0.45, size * 0.35, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // Pointing at something: a dashed data wire from her finger to it, brackets on its corners and a
  // tag. from() and rect() are asked every frame. Returns { retract }: the wire reels back in.
  pointer(from, rect, { label = '' } = {}) {
    const e = { kind: 'pointer', from, rect, label, t: 0, life: Infinity, max: Infinity };
    this.effects.push(e);
    return {
      retract: () => {
        if (e.life === Infinity) {
          e.life = 0.35;
          e.max = 0.35;
        }
      },
    };
  }

  drawPointer(ctx, e) {
    const r = e.rect();
    const f = e.from();
    if (!r || !f) return;
    const { cyan, magenta, navy, white } = this.palette;
    const k = e.life === Infinity ? Math.min(1, e.t * 5) : Math.max(0, e.life / e.max);
    const clampTo = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const aim = { x: clampTo(f.x, r.x + 24, r.x + r.w - 24), y: clampTo(f.y, r.y + 24, r.y + r.h - 24) };
    const end = { x: f.x + (aim.x - f.x) * k, y: f.y + (aim.y - f.y) * k };
    ctx.save();
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -e.t * 40; // the data runs along it
    ctx.shadowColor = cyan;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    if (e.life === Infinity) {
      // brackets on its corners
      const b = Math.min(28, r.w / 4, r.h / 4);
      ctx.strokeStyle = magenta;
      ctx.lineWidth = 3;
      for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + sy * b);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * b, cy);
        ctx.stroke();
      }
      if (e.label) {
        ctx.font = '600 12px "JetBrains Mono", monospace';
        const w = ctx.measureText(e.label).width + 14;
        ctx.fillStyle = navy;
        ctx.fillRect(r.x, Math.max(0, r.y - 22), w, 20);
        ctx.strokeStyle = magenta;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x, Math.max(0, r.y - 22), w, 20);
        ctx.fillStyle = white;
        ctx.fillText(e.label, r.x + 7, Math.max(0, r.y - 22) + 14);
      }
    }
    ctx.restore();
  }

  glitch(ms, strength = 1) {
    this.glitchState = { life: ms / 1000, strength };
  }

  glitching() {
    return this.glitchState && this.glitchState.life > 0 ? this.glitchState.strength : 0;
  }

  // ---- time ----

  update(dt) {
    const h = Math.min(MAX_DT, Math.max(0, dt || 0));
    for (const p of this.particles) {
      p.life -= h;
      if (p.kind === 'assemble') {
        p.t = Math.min(1, p.t + h / p.dur);
        const e = easeIn(p.t);
        const swirl = 20 * p.swirl * (1 - e) * Math.sin(p.t * Math.PI);
        p.x = p.from.x + (p.to.x - p.from.x) * e + swirl;
        p.y = p.from.y + (p.to.y - p.from.y) * e - swirl;
      } else {
        p.vy += (p.g || 0) * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
      }
      if (p.vr) p.rot += p.vr * h;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const e of this.effects) {
      if (e.kind === 'pointer') e.t += h;
      if (e.kind === 'possess') {
        e.t += h;
        e.clock += h;
        if (e.clock >= DRAWING || !e.slices.length) {
          e.clock = 0;
          e.slices = Array.from({ length: 4 }, () => ({ y: this.rand(), h: this.r(0.01, 0.05), dx: this.r(-24, 24), c: this.rand() < 0.5 }));
        }
      }
      e.life -= h;
      if (e.kind === 'bolt' || e.kind === 'speed') {
        e.clock += h;
        if (e.clock >= DRAWING) {
          e.clock %= DRAWING;
          if (e.kind === 'bolt') e.points = this.jag(e.from, e.to, e.rough);
          else e.angles = e.angles.map(() => this.r(0, TAU));
        }
      }
    }
    this.effects = this.effects.filter((e) => e.life > 0);

    if (this.impactState) {
      this.impactState.life -= h;
      if (this.impactState.life <= 0) this.impactState = null;
    }
    if (this.glitchState) {
      this.glitchState.life -= h;
      if (this.glitchState.life <= 0) this.glitchState = null;
    }
    this.sliceClock += h;
  }

  // ---- drawing ----

  draw(ctx) {
    const { cyan, white, red, navy } = this.palette;
    ctx.save();
    for (const e of this.effects) {
      const k = e.max ? Math.max(0, e.life / e.max) : 1;
      if (e.kind === 'column') {
        const g = ctx.createLinearGradient(0, 0, 0, e.y);
        g.addColorStop(0, 'rgba(62,242,255,0)');
        g.addColorStop(1, cyan);
        ctx.globalAlpha = 0.55 * k;
        ctx.fillStyle = g;
        ctx.fillRect(e.x - 22 * k - 4, 0, 44 * k + 8, e.y);
        ctx.globalAlpha = 0.9 * k;
        ctx.fillStyle = white;
        ctx.fillRect(e.x - 2, 0, 4, e.y);
      } else if (e.kind === 'slit') {
        ctx.globalAlpha = k;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, 3 + 4 * k, 46, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 40);
        ctx.lineTo(e.x, e.y + 40);
        ctx.stroke();
      } else if (e.kind === 'ring') {
        const t = 1 - k;
        ctx.globalAlpha = k;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2 + 6 * k;
        hexPath(ctx, e.x, e.y, 14 + 220 * t, t);
        ctx.stroke();
      } else if (e.kind === 'speed') {
        ctx.globalAlpha = 0.7 * k;
        ctx.strokeStyle = white;
        ctx.lineWidth = 2;
        for (const a of e.angles) {
          const r0 = e.inner + this.r(0, 60);
          ctx.beginPath();
          ctx.moveTo(e.cx + Math.cos(a) * r0, e.cy + Math.sin(a) * r0);
          ctx.lineTo(e.cx + Math.cos(a) * e.outer, e.cy + Math.sin(a) * e.outer);
          ctx.stroke();
        }
      } else if (e.kind === 'bolt') {
        ctx.globalAlpha = 1;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.width * 2.2;
        this.polyline(ctx, e.points);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = white;
        ctx.lineWidth = e.width * 0.7;
        this.polyline(ctx, e.points);
        ctx.stroke();
      } else if (e.kind === 'possess') {
        this.drawPossess(ctx, e);
      } else if (e.kind === 'pointer') {
        this.drawPointer(ctx, e);
      } else if (e.kind === 'flash') {
        const tone = e.tone === 'red' ? red : e.tone === 'ink' ? navy : white;
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 240);
        g.addColorStop(0, tone);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55 * k;
        ctx.fillStyle = g;
        ctx.fillRect(e.x - 240, e.y - 240, 480, 480);
      }
    }
    ctx.shadowBlur = 0;
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = p.kind === 'assemble' ? 1 : Math.min(1, k * 1.4);
      if (p.kind === 'shard' || p.kind === 'assemble') {
        ctx.fillStyle = p.color;
        hexPath(ctx, p.x, p.y, p.size, p.rot);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.kind === 'glyph') {
        ctx.fillStyle = p.color;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(p.text, p.x, p.y);
      }
    }
    ctx.restore();
  }

  polyline(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  // Draws her layer (src, a canvas) at (x, y), through the glitch when one is running: shifted
  // horizontal slices and a magenta/cyan channel split.
  post(ctx, src, x, y) {
    const s = this.glitching();
    if (!s) {
      ctx.drawImage(src, x, y);
      return;
    }
    const w = src.width;
    const h = src.height;
    if (!this.tinted || this.tinted.w !== w || this.tinted.h !== h) this.tinted = { w, h, magenta: this.canvas(w, h), cyan: this.canvas(w, h) };
    for (const [name, colour] of [['magenta', this.palette.magenta], ['cyan', this.palette.cyan]]) {
      const t = this.tinted[name].getContext('2d');
      t.globalCompositeOperation = 'copy';
      t.drawImage(src, 0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = colour;
      t.fillRect(0, 0, w, h);
    }
    const split = 6 * s;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.tinted.magenta, x - split, y);
    ctx.drawImage(this.tinted.cyan, x + split, y);
    ctx.restore();
    if (this.sliceClock >= DRAWING || !this.glitchSlices.length) {
      this.sliceClock = 0;
      const n = 8;
      this.glitchSlices = Array.from({ length: n }, (_, i) => ({ y: (i * h) / n, h: h / n, dx: this.rand() < 0.5 ? this.r(-18, 18) * s : 0 }));
    }
    for (const sl of this.glitchSlices) ctx.drawImage(src, 0, sl.y, w, sl.h, x + sl.dx, y + sl.y, w, sl.h);
  }

  canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
}
