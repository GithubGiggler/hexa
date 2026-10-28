// Her hair strands and her cable: verlet chains hanging from a bone. Each point keeps exactly one
// segment length from the one before (follow-the-leader), so however long a frame takes, a chain
// can never stretch or explode; time steps are clamped too.

const SUBSTEP = 1 / 30;
const MAX_SUBSTEPS = 4;

export class Chain {
  constructor({ segments, length, stiffness = 0.3, damping = 0.9, gravity = 900, angle = 0 }) {
    this.segments = segments;
    this.length = length;
    this.stiffness = stiffness;
    this.damping = damping;
    this.gravity = gravity;
    this.angle = angle; // its rest direction, relative to the anchor's angle (0 hangs straight down)
    this.pts = null;
  }

  // the rest direction for an anchor angle a: the same clockwise convention as the rig
  restDir(a) {
    const t = a + this.angle;
    return [-Math.sin(t), Math.cos(t)];
  }

  lay(anchor) {
    const [dx, dy] = this.restDir(anchor.a);
    this.pts = Array.from({ length: this.segments + 1 }, (_, i) => {
      const x = anchor.x + dx * this.length * i;
      const y = anchor.y + dy * this.length * i;
      return { x, y, px: x, py: y };
    });
  }

  // anchor: { x, y, a } in screen space; wind: sideways push (px/s²); lift: upward push (px/s²)
  step(anchor, dt, wind = 0, lift = 0) {
    if (!this.pts) this.lay(anchor);
    const total = Math.min(Math.max(0, dt || 0), SUBSTEP * MAX_SUBSTEPS);
    const n = Math.max(1, Math.ceil(total / SUBSTEP));
    const h = total / n;
    const [dx, dy] = this.restDir(anchor.a);
    const pull = 1 - Math.pow(1 - this.stiffness, h * 60); // the same stiffness at any frame rate
    for (let s = 0; s < n; s++) {
      const p0 = this.pts[0];
      p0.x = anchor.x; p0.y = anchor.y; p0.px = anchor.x; p0.py = anchor.y;
      for (let i = 1; i < this.pts.length; i++) {
        const p = this.pts[i];
        const vx = (p.x - p.px) * this.damping;
        const vy = (p.y - p.py) * this.damping;
        p.px = p.x; p.py = p.y;
        p.x += vx + wind * h * h;
        p.y += vy + (this.gravity - lift) * h * h;
        // springs back toward its rest shape
        p.x += (anchor.x + dx * this.length * i - p.x) * pull;
        p.y += (anchor.y + dy * this.length * i - p.y) * pull;
      }
      for (let i = 1; i < this.pts.length; i++) {
        const a = this.pts[i - 1];
        const p = this.pts[i];
        const ex = p.x - a.x;
        const ey = p.y - a.y;
        const d = Math.hypot(ex, ey);
        if (!(d > 1e-6) || !Number.isFinite(d)) {
          p.x = a.x + dx * this.length; p.y = a.y + dy * this.length;
          p.px = p.x; p.py = p.y;
          continue;
        }
        const k = this.length / d;
        p.x = a.x + ex * k;
        p.y = a.y + ey * k;
      }
    }
    return this.pts;
  }

  get points() {
    return this.pts ? this.pts.map(({ x, y }) => ({ x, y })) : [];
  }

  // a teleport or a drop: the chain shouldn't whip across the screen from where she was
  reset(anchor) {
    this.lay(anchor);
  }
}
