// A character pack: her skeleton, the shapes on it, her hair and cable chains, her colours and her
// visor glyphs, all in pack.json. Validated by hand (no dependency), so a broken pack is explained
// instead of drawing nonsense. Format: docs/character-packs.md, schema: packs/pack.schema.json.

import { GLYPH_NAMES, isGlyph } from './glyphs.js';

// Path data uses absolute M, L, C, Q and Z only. Returns [{ c, p: [numbers] }] or throws.
const ARGS = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
export function parsePath(d) {
  const tokens = String(d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let cmd = null;
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i];
      if (!(cmd in ARGS)) throw new Error(`unsupported path command "${cmd}"`);
      i += 1;
      if (cmd === 'Z') {
        out.push({ c: 'Z', p: [] });
        continue;
      }
    }
    if (!cmd || cmd === 'Z') throw new Error('path data must start with M');
    const n = ARGS[cmd];
    const p = tokens.slice(i, i + n).map(Number);
    if (p.length !== n || p.some((v) => !Number.isFinite(v))) throw new Error(`"${cmd}" needs ${n} numbers`);
    out.push({ c: cmd, p });
    i += n;
    if (cmd === 'M') cmd = 'L'; // extra pairs after M are lines, as in SVG
  }
  if (!out.length || out[0].c !== 'M') throw new Error('path data must start with M');
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validatePack(pack) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['pack is not an object'] };
  if (typeof pack.id !== 'string' || !pack.id) err('id must be a non-empty string');
  if (pack.version !== 1) err('version must be 1');
  if (!isNum(pack.height) || pack.height <= 0) err('height must be a positive number');

  const palette = pack.palette && typeof pack.palette === 'object' ? pack.palette : {};
  if (!pack.palette) err('palette is missing');
  for (const [k, v] of Object.entries(palette)) if (!/^#[0-9a-f]{6}$/i.test(v)) err(`palette.${k} must be #rrggbb`);
  const colour = (where, key, special = []) => {
    if (key === undefined || special.includes(key)) return;
    if (!(key in palette)) err(`${where}: unknown colour "${key}"`);
  };

  const bones = new Set();
  if (!Array.isArray(pack.bones) || !pack.bones.length) err('bones must be a non-empty array');
  (pack.bones || []).forEach((b, i) => {
    const where = `bone ${b?.id ?? i}`;
    if (typeof b?.id !== 'string') return err(`${where}: id must be a string`);
    if (bones.has(b.id)) err(`${where}: duplicate id`);
    if (i === 0 && b.parent !== null) err(`${where}: the first bone is the root, its parent must be null`);
    if (i > 0 && !bones.has(b.parent)) err(`${where}: parent "${b.parent}" is not defined before it`);
    if (!isNum(b.x) || !isNum(b.y)) err(`${where}: x and y must be numbers`);
    if (b.sign !== undefined && b.sign !== 1 && b.sign !== -1) err(`${where}: sign must be 1 or -1`);
    for (const k of ['pose', 'stretch']) if (b[k] !== undefined && typeof b[k] !== 'string') err(`${where}: ${k} must be a pose field name`);
    bones.add(b.id);
  });

  const ids = new Set();
  for (const p of pack.parts || []) {
    const where = `part ${p?.id}`;
    if (typeof p?.id !== 'string') { err('a part has no id'); continue; }
    if (ids.has(p.id)) err(`${where}: duplicate id`);
    ids.add(p.id);
    if (!bones.has(p.bone)) err(`${where}: unknown bone "${p.bone}"`);
    if (!isNum(p.z)) err(`${where}: z must be a number`);
    if (p.fill === undefined && p.stroke === undefined) err(`${where}: needs a fill or a stroke`);
    colour(where, p.fill, ['emblem', 'none']);
    colour(where, p.stroke);
    try { parsePath(p.path); } catch (e) { err(`${where}: ${e.message}`); }
  }
  if (!Array.isArray(pack.parts)) err('parts must be an array');

  for (const c of pack.chains || []) {
    const where = `chain ${c?.id}`;
    if (typeof c?.id !== 'string') { err('a chain has no id'); continue; }
    if (ids.has(c.id)) err(`${where}: duplicate id`);
    ids.add(c.id);
    if (!bones.has(c.bone)) err(`${where}: unknown bone "${c.bone}"`);
    if (!Number.isInteger(c.segments) || c.segments < 1 || c.segments > 12) err(`${where}: segments must be 1 to 12`);
    if (!isNum(c.length) || c.length <= 0) err(`${where}: length must be positive`);
    if (!Array.isArray(c.width) || c.width.length !== 2 || !c.width.every(isNum)) err(`${where}: width must be [base, tip]`);
    if (!isNum(c.z)) err(`${where}: z must be a number`);
    colour(where, c.color);
    colour(where, c.tip);
  }

  const glyphs = pack.glyphs && typeof pack.glyphs === 'object' ? pack.glyphs : {};
  for (const name of GLYPH_NAMES) if (!(name in glyphs)) err(`glyph "${name}" is missing`);
  for (const [name, eyes] of Object.entries(glyphs)) if (!isGlyph(eyes)) err(`glyph "${name}" must be two 5×5 grids of . and #`);

  return { ok: errors.length === 0, errors };
}

// Loads a pack, falling back to the default one (with the reasons in the console) if it's broken.
export async function loadPack(url, fallbackUrl = 'hexa://app/packs/hexa/pack.json') {
  try {
    const pack = await (await fetch(url)).json();
    const { ok, errors } = validatePack(pack);
    if (ok) return pack;
    console.warn(`[hexa] pack ${url} is broken, using Hexa:\n  ${errors.join('\n  ')}`);
  } catch (e) {
    console.warn(`[hexa] pack ${url} could not be loaded (${e.message}), using Hexa`);
  }
  if (url === fallbackUrl) throw new Error('the default pack is broken');
  return loadPack(fallbackUrl, fallbackUrl);
}
