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
