// Her skeleton: a pose (a few numbers, see acting.js NEUTRAL) becomes a world transform for every
// bone. Matrices are canvas-style [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
// Angles rotate clockwise on screen; a bone's 0 points the way it's drawn (limbs hang down).

import { parsePath } from './pack.js';

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const T = (x, y) => [1, 0, 0, 1, x, y];
const S = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const R = (a) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];

export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// The part's own bounding box, control points included (so it's never too small).
function localBounds(cmds) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const { p } of cmds) {
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
    }
  }
  return [x0, y0, x1, y1];
}

export function buildRig(pack) {
  const bones = pack.bones.map((b) => ({ ...b }));
  const byId = new Map(bones.map((b) => [b.id, b]));
  const parts = pack.parts
    .map((p) => {
      const cmds = parsePath(p.path);
      return { ...p, cmds, box: localBounds(cmds) };
    })
    .sort((a, b) => a.z - b.z);
  return { pack, bones, byId, parts, chains: pack.chains || [], palette: pack.palette, glyphs: pack.glyphs };
}

// How much a bone is stretched along its length: a long arm, or thighs folded toward you to sit.
function lengthScale(bone, pose) {
  if (bone.stretch) return pose[bone.stretch] ?? 1;
  if (bone.fold) return 1 - 0.7 * Math.min(1, Math.max(0, pose.fold || 0));
  return 1;
}

export function solvePose(rig, pose, { x = 0, y = 0, scale = 1, dir = 1 } = {}) {
  const out = new Map();
  const stretch = new Map();
  for (const bone of rig.bones) {
    let m;
    if (bone.parent === null) {
      const tilt = ((pose.tilt || 0) * Math.PI) / 180;
      m = mul(mul(mul(mul(T(x, y), S(dir, 1)), T(0, (pose.bob || 0) * scale)), R(tilt)), S(scale * (pose.sx ?? 1), scale * (pose.sy ?? 1)));
    } else {
      const parent = out.get(bone.parent).m;
      const undo = stretch.get(bone.parent) || 1; // children of a stretched bone keep their own size
      const angle = (bone.pose ? pose[bone.pose] || 0 : 0) * (bone.sign || 1);
      m = mul(mul(mul(parent, T(bone.x, bone.y)), S(1, 1 / undo)), R(angle));
    }
    const s = lengthScale(bone, pose);
    if (s !== 1) {
      m = mul(m, S(1, s));
      stretch.set(bone.id, s);
    }
    out.set(bone.id, { x: m[4], y: m[5], a: Math.atan2(m[1], m[0]), sx: Math.hypot(m[0], m[1]), sy: Math.hypot(m[2], m[3]), m });
  }
  return out;
}

export function partBounds(rig, xf) {
  const out = new Map();
  for (const part of rig.parts) {
    const { m } = xf.get(part.bone);
    const [x0, y0, x1, y1] = part.box;
    const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    out.set(part.id, [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY]);
  }
  return out;
}

const union = (a, b) => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// Where she takes clicks: her parts' boxes, padded, joined where they overlap, at most max of them.
export function hitRects(rig, xf, pad = 4, max = 12) {
  let list = [...partBounds(rig, xf).values()].map(([x, y, w, h]) => [x - pad, y - pad, w + 2 * pad, h + 2 * pad]);
  for (let joined = true; joined;) {
    joined = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i], list[j])) {
          list[i] = union(list[i], list[j]);
          list.splice(j, 1);
          joined = true;
          break outer;
        }
      }
    }
  }
  while (list.length > max) {
    let best = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const u = union(list[i], list[j]);
        const cost = u[2] * u[3] - list[i][2] * list[i][3] - list[j][2] * list[j][3];
        if (!best || cost < best.cost) best = { i, j, u, cost };
      }
    }
    list[best.i] = best.u;
    list.splice(best.j, 1);
  }
  list = list.map((r) => r.map((v) => Math.round(v * 10) / 10));
  return list;
}
