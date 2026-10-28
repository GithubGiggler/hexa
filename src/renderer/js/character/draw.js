// Drawing her: every part of the pack on its bone, her hair and cable chains in between by depth,
// the LED eyes on her visor, her emblem in her state colour, the link LEDs on her ear nodes.
// Paths are rebuilt from their commands each drawing so the line can "boil" a little, the way a
// hand-redrawn cel wobbles; the same drawing index always boils the same way.

import { apply } from './rig.js';
import { Chain } from './physics.js';
import { drawGlyph } from './glyphs.js';

// visor glyph area, in head space: two 5×5 eyes around (-16.5, -34) and (16.5, -34)
const VISOR_RECT = [-33, -42.5, 66, 17];

const hash = (seed, i) => {
  const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function makeChains(rig) {
  return new Map(rig.chains.map((c) => [c.id, new Chain({
    segments: c.segments, length: c.length, stiffness: c.stiffness ?? 0.3, damping: c.damping ?? 0.9, angle: c.angle || 0,
  })]));
}

// Where a chain hangs from, in screen space, and the anchor angle that points it the way its bone
// points (mirrored and stretched bones included).
export function anchorFor(rig, xf, def) {
  const { m } = xf.get(def.bone);
  const [x, y] = apply(m, def.x, def.y);
  const lx = -Math.sin(def.angle || 0);
  const ly = Math.cos(def.angle || 0);
  const dx = m[0] * lx + m[2] * ly;
  const dy = m[1] * lx + m[3] * ly;
  return { x, y, a: Math.atan2(-dx, dy) - (def.angle || 0) };
}

function tracePath(ctx, cmds, boil) {
  let k = 0;
  const j = () => (hash(boil, k++) - 0.5) * 1.2; // ±0.6 px
  ctx.beginPath();
  for (const { c, p } of cmds) {
    if (c === 'M') ctx.moveTo(p[0] + j(), p[1] + j());
    else if (c === 'L') ctx.lineTo(p[0] + j(), p[1] + j());
    else if (c === 'C') ctx.bezierCurveTo(p[0] + j(), p[1] + j(), p[2] + j(), p[3] + j(), p[4] + j(), p[5] + j());
    else if (c === 'Q') ctx.quadraticCurveTo(p[0] + j(), p[1] + j(), p[2] + j(), p[3] + j());
    else if (c === 'Z') ctx.closePath();
  }
}

function drawPart(ctx, rig, xf, part, look) {
  const pal = rig.palette;
  const { m } = xf.get(part.bone);
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  tracePath(ctx, part.cmds, look.boil || 0);
  if (part.fill && part.fill !== 'none') {
    if (part.role === 'emblem') {
      ctx.fillStyle = look.emblem;
      ctx.shadowColor = look.emblem;
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = pal[part.fill];
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (part.stroke) {
    ctx.strokeStyle = pal[part.stroke];
    ctx.lineWidth = part.width || 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  if (part.role === 'visor' && look.visor) {
    const eyes = rig.glyphs[look.visor] || rig.glyphs.calm;
    drawGlyph(ctx, eyes, VISOR_RECT, pal.amber, { lit: look.visorLit ?? 1 });
  }
  if ((part.role === 'earL' || part.role === 'earR') && look.link > 0) {
    // the link LED: lit for a moment on every Claude action, like a network card's
    const [x0, y0, x1, y1] = part.box;
    ctx.beginPath();
    ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, 2.4, 0, Math.PI * 2);
    ctx.globalAlpha = Math.min(1, look.link);
    ctx.fillStyle = pal.cyan;
    ctx.shadowColor = pal.cyan;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawChain(ctx, rig, xf, def, chain, scale) {
  if (!chain) return;
  if (!chain.pts) chain.reset(anchorFor(rig, xf, def));
  const pal = rig.palette;
  const pts = chain.pts;
  const [w0, w1] = def.width;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal[def.color];
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = (w0 + ((w1 - w0) * i) / Math.max(1, pts.length - 2)) * scale;
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    ctx.stroke();
  }
  const end = pts[pts.length - 1];
  if (def.tip) {
    ctx.fillStyle = pal[def.tip];
    ctx.shadowColor = pal[def.tip];
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (def.plug) {
      const prev = pts[pts.length - 2];
      const a = Math.atan2(end.y - prev.y, end.x - prev.x);
      ctx.translate(end.x, end.y);
      ctx.rotate(a);
      ctx.rect(0, -3 * scale, 7 * scale, 6 * scale);
    } else {
      ctx.arc(end.x, end.y, Math.max(1, w1 * 0.6 * scale), 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

// look: { visor: glyph name, emblem: css colour, link: 0..1, boil: drawing index, alpha = 1 }
export function drawCharacter(ctx, rig, xf, chains, pose, look) {
  const scale = xf.get(rig.bones[0].id).sy || 1;
  const layers = [
    ...rig.parts.map((part) => ({ z: part.z, part })),
    ...rig.chains.map((def) => ({ z: def.z, def })),
  ].sort((a, b) => a.z - b.z);
  ctx.save();
  ctx.globalAlpha = look.alpha ?? 1;
  for (const layer of layers) {
    if (layer.part) drawPart(ctx, rig, xf, layer.part, look);
    else drawChain(ctx, rig, xf, layer.def, chains.get(layer.def.id), scale);
  }
  ctx.restore();
}

// Her core: what's left of her when she suspends or goes to the background. A glowing hexagon
// with her visor across it.
export function drawCore(ctx, x, y, size, { visor, emblem, palette, lit = 1 }) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = palette.navy;
  ctx.shadowColor = emblem;
  ctx.shadowBlur = size * 0.35;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = emblem;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.stroke();
  // the visor band across it
  ctx.beginPath();
  ctx.rect(-r * 0.78, -r * 0.24, r * 1.56, r * 0.48);
  ctx.fillStyle = palette.visor;
  ctx.fill();
  ctx.strokeStyle = palette.amber;
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke();
  if (visor) drawGlyph(ctx, visor, [-r * 0.7, -r * 0.2, r * 1.4, r * 0.4], palette.amber, { lit });
  ctx.restore();
}
